"""
Make one finished short again with the changes from the Edit tab on the website.

Usage:  python remake.py <job_dir> <clip_id> <edits.json>
edits:  {"startDelta": -3, "endDelta": 5, "hook": "text shown first", "style": {...style.py...},
         "lines": [{"from": 0, "to": 5, "text": "fixed words"}]}
        Older callers may send "layout" (facecam/gameplay/full) and "captions" (bold/simple/none) instead of style.
        "lines" fix caption words: from/to index the short's current words (clip["words"] split on spaces).
Writes: clips/remake-<clip_id>.json while working ("running", then "done" or "failed"),
        then the new short under a new file name, updates clips.json and removes the old files.
"""

import quiet  # noqa: F401  (must come first: hides helper windows on Windows)
import json
import os
import re
import sys
import threading
import time
import traceback
from qc import safe_check
from pathlib import Path

from fetch import FetchError, download_range, remote_source
from make_short import clip_caption_words, render_short
from style import normalize
from transcribe import load_key, scrub

MAX_SHIFT = 30          # seconds the start or end may move either way
MIN_LENGTH = 5
VIDEO = re.compile(r"^source(_video)?\.(mp4|mov|mkv|webm)$", re.I)


def write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    for _ in range(40):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.05)
    raise RuntimeError(f"Could not save {path.name} (file busy)")


def timed_tokens(clip: dict, base: list[dict]) -> list[dict]:
    """The short's words as the website shows them, each with a time.
    Older shorts stored no timings; those borrow the nearest freshly converted word's time."""
    shown = clip.get("words", "").split()
    if not base:
        return []
    if len(shown) == len(base):
        return [{**b, "text": s} for s, b in zip(shown, base)]
    return [{**base[min(len(base) - 1, k * len(base) // len(shown))], "text": s} for k, s in enumerate(shown)]


def _kept_mask(words: list[dict]) -> list[bool]:
    """Which caption words survive the Whisper-instruction clean-up (same order)."""
    marked = [{"word": w["text"], "i": i} for i, w in enumerate(words)]
    kept = {x["i"] for x in scrub({"words": marked, "segments": []})["words"]}
    return [i in kept for i in range(len(words))]


def apply_lines(words: list[dict], lines: list[dict]) -> list[dict]:
    """Replace word ranges with the user's text. Same word count keeps each word's time;
    a different count spreads the new words evenly over the line's time."""
    out, i = [], 0
    for ln in sorted(lines, key=lambda x: int(x.get("from", 0))):
        a, b = int(ln.get("from", 0)), int(ln.get("to", 0))
        if a < i or b <= a or b > len(words):
            continue  # overlapping or out of range: ignore that line
        out += words[i:a]
        span, new = words[a:b], str(ln.get("text", "")).split()
        if len(new) == len(span):
            out += [{**w, "text": t} for w, t in zip(span, new)]
        elif new:
            s, e = span[0]["start"], span[-1]["end"]
            step = (e - s) / len(new)
            out += [{"text": t, "start": round(s + k * step, 2), "end": round(s + (k + 1) * step, 2)} for k, t in enumerate(new)]
        i = b
    return out + words[i:]


def remake_one(job_dir: Path, clip_id: str, edits: dict) -> bool:
    """Make one short again; its progress goes to clips/remake-<clip_id>.json. False if it failed."""
    out = job_dir / "clips"
    state_file = out / f"remake-{clip_id}.json"
    started = time.time()

    def status(state: str, error: str | None = None) -> None:
        write_json(state_file, {"state": state, "error": error, "started": started, "updated": time.time(), "pid": os.getpid()})

    # Heartbeat: on a slow connection a remake can take many minutes; the website must see it is alive.
    alive = threading.Event()

    def beat() -> None:
        while not alive.wait(20):
            try:
                status("running")
            except Exception:
                pass

    threading.Thread(target=beat, daemon=True).start()
    try:
        status("running")
        summary = json.loads((out / "clips.json").read_text(encoding="utf-8"))
        meta = json.loads((job_dir / "meta.json").read_text(encoding="utf-8"))
        clip = next((c for c in summary["clips"] if c["id"] == clip_id), None)
        if not clip:
            raise RuntimeError("This short no longer exists.")
        tfile = next((job_dir / "signals").glob("*.transcript.json"), None)
        if not tfile:
            raise RuntimeError("The transcript of this video is missing, so the short can't be made again.")
        transcript = json.loads(tfile.read_text(encoding="utf-8"))
        # Projects made from a part of a long stream keep the transcript in part time; shorts use full-video time.
        offset = float(summary.get("offsetSec") or 0)
        if offset:
            transcript = {**transcript, "words": [{**w, "start": w["start"] + offset, "end": w["end"] + offset} for w in transcript["words"]]}
        language = (summary.get("settings") or {}).get("language") or "hi"
        if language != "hi":
            transcript = scrub(transcript)
        key = load_key()

        start, dur = float(clip["startSec"]), float(clip["durSec"])
        total = float(summary.get("sourceSec") or summary.get("durationSec") or start + dur)
        ds = max(-MAX_SHIFT, min(MAX_SHIFT, float(edits.get("startDelta", 0))))
        de = max(-MAX_SHIFT, min(MAX_SHIFT, float(edits.get("endDelta", 0))))
        new_start, new_end = max(0.0, start + ds), min(total, start + dur + de)
        if new_end - new_start < MIN_LENGTH:
            raise RuntimeError(f"The short would be shorter than {MIN_LENGTH} seconds. Move the start or end less.")
        length = new_end - new_start

        # Caption words: the current ones (with the user's fixes), moved to the new start,
        # plus freshly converted words for any seconds added at either end.
        base = clip.get("capWords") or clip_caption_words(key, transcript, start, dur, language)
        words = apply_lines(timed_tokens(clip, base), edits.get("lines") or [])
        if language != "hi":  # captions saved before the echo clean-up may still contain Whisper's instructions
            words = [w for w, ok in zip(words, _kept_mask(words)) if ok]
        shift = new_start - start
        words = [{**w, "start": round(w["start"] - shift, 2), "end": round(min(length, w["end"] - shift), 2)}
                 for w in words if 0 <= w["start"] - shift < length]
        if new_start < start:
            words = clip_caption_words(key, transcript, new_start, start - new_start, language) + words
        if new_end > start + dur:
            tail = clip_caption_words(key, transcript, start + dur, new_end - start - dur, language)
            words += [{**w, "start": round(w["start"] + start + dur - new_start, 2), "end": round(w["end"] + start + dur - new_start, 2)} for w in tail]

        # Look: the edited style, else this short's own, else the project's. The facecam box found
        # when the project was made is reused unless the user drew one.
        box = summary.get("facecam")
        layout = summary.get("layout") or "auto"
        base = clip.get("style") or summary.get("style") or normalize(None, "none" if clip.get("layout") == "gameplay" else layout, clip.get("captions", "bold"))
        style = normalize(edits.get("style") or base)
        if not edits.get("style") and (edits.get("layout") or edits.get("captions")):
            style["layout"] = {"facecam": "top", "gameplay": "game", "full": "full"}.get(edits.get("layout"), style["layout"])
            style["captions"]["style"] = {"bold": "word", "simple": "box", "none": "none"}.get(edits.get("captions"), style["captions"]["style"])
        captions = {"word": "bold", "box": "simple", "none": "none"}[style["captions"]["style"]]
        choice = {"top": "facecam", "bottom": "facecam", "pip": "facecam", "game": "gameplay", "full": "full"}[style["layout"]]
        # The teaser and zoom moments stay where they were in the video, as long as they are still inside.
        peak = clip.get("peakSec")
        peak = peak - new_start if peak is not None and new_start + 1 <= peak <= new_end - 1 else length / 2
        zooms = [(a - new_start, b - new_start) for a, b in clip.get("zoomSec") or [] if new_start <= a and b <= new_end]
        hook = str(edits.get("hook", clip.get("hook") or "")).strip()[:80] or None

        # Where to cut from: the uploaded file, a full download of the link, or YouTube directly.
        video = next((p for p in sorted(job_dir.iterdir()) if VIDEO.match(p.name)), None)
        remote, base, piece = None, 0.0, clip.get("piece")
        if not video:
            if not meta.get("url"):
                raise RuntimeError("The original video is missing, so the short can't be made again.")
            # The piece downloaded for this short covers 20 s either side; outside that, fetch a new one.
            pf = job_dir / "pieces" / piece["file"] if piece else None
            if pf and pf.exists() and piece["base"] <= new_start and new_end <= piece["end"]:
                video, base = pf, float(piece["base"])
            else:
                try:
                    lo_t, hi_t = max(0.0, new_start - 20), new_end + 20
                    got = download_range(meta["url"], lo_t, hi_t, job_dir / "pieces" / f"{clip_id}-{int(time.time())}.mp4")
                    if got:
                        video, base = got["file"], float(got["base"])
                        piece = {"file": got["file"].name, "base": base, "end": hi_t}
                except FetchError as e:
                    print(f"    piece download failed: {e}", flush=True)
            if not video:
                remote = remote_source(meta["url"])

        n = int(clip.get("edits", 0)) + 1
        name = re.sub(r"-e\d+$", "", Path(clip["file"]).stem) + f"-e{n}"
        res = None
        for attempt in (1, 2):  # YouTube now and then refuses one read (HTTP 403): a fresh address usually works
            try:
                res = render_short(video, new_start, length, out, name, key, transcript, hook, layout, remote, box, captions, words_override=words,
                                   language=language, style=style, peak=peak, zooms=zooms, base=base)
                break
            except RuntimeError as e:
                print(f"    remake attempt {attempt} failed: {str(e)[:200]}", flush=True)
                if attempt == 2:
                    raise
                if remote or (meta.get("url") and video and "pieces" in str(video)):
                    video, base, remote = None, 0.0, remote_source(meta["url"])

        # Save under the new name (so browsers don't show the old cached video), then remove the old files.
        summary = json.loads((out / "clips.json").read_text(encoding="utf-8"))
        clip = next(c for c in summary["clips"] if c["id"] == clip_id)
        old = [clip["file"], clip["poster"], Path(clip["file"]).with_suffix(".ass").name] + ([clip["frame"]] if clip.get("frame") else [])
        clip.update({"file": res["file"], "poster": res["poster"], "startSec": round(new_start, 2), "durSec": round(length, 2),
                     "hook": hook or "", "words": " ".join(w["text"] for w in words), "capWords": words,
                     "layout": choice, "captions": captions, "style": res["style"], "frame": res.get("frame"), "piece": piece, "edits": n,
                     "qc": safe_check(out / res["file"])})
        write_json(out / "clips.json", summary)
        tl_file = out / "timeline.json"
        if tl_file.exists():
            tl = json.loads(tl_file.read_text(encoding="utf-8"))
            for m in tl.get("moments", []):
                if m.get("id") == clip_id:
                    m["start"], m["end"] = round(new_start, 2), round(new_end, 2)
            write_json(tl_file, tl)
        for f in old:
            try:
                (out / f).unlink(missing_ok=True)
            except PermissionError:  # still being streamed to a browser; harmless leftover
                pass
        alive.set()
        status("done")
        print(f"Remade {clip_id}: {fmt_s(new_start)} for {length:.1f} s, layout {layout}, captions {captions}", flush=True)
    except BaseException as e:
        traceback.print_exc()
        msg = str(e) or e.__class__.__name__
        alive.set()
        status("failed", "Making the short again failed while cutting the video. Try once more." if msg.startswith("FFmpeg") else msg[-400:])
        if isinstance(e, KeyboardInterrupt):
            raise
        return False
    finally:
        alive.set()
    return True


def main() -> None:
    """remake.py <job_dir> <clip_id> <edits.json>, or clip_id ALL to give every short the same look
    (only the style in the edits is used then; each short keeps its own start, end, words and opening line)."""
    job_dir, clip_id, edits_file = Path(sys.argv[1]).resolve(), sys.argv[2], Path(sys.argv[3])
    try:
        edits = json.loads(edits_file.read_text(encoding="utf-8"))
    finally:
        edits_file.unlink(missing_ok=True)
    if clip_id != "ALL":
        raise SystemExit(0 if remake_one(job_dir, clip_id, edits) else 1)
    out = job_dir / "clips"
    review_file = job_dir / "review.json"
    review = json.loads(review_file.read_text(encoding="utf-8")) if review_file.exists() else {}
    skip = set(edits.get("exclude") or [])
    ids = [c["id"] for c in json.loads((out / "clips.json").read_text(encoding="utf-8"))["clips"] if review.get(c["id"]) != "deleted" and c["id"] not in skip]
    state = out / "remake-all.json"
    started, failed = time.time(), 0
    for n, cid in enumerate(ids):
        write_json(state, {"state": "running", "done": n, "total": len(ids), "current": cid, "failed": failed, "started": started, "updated": time.time()})
        if not remake_one(job_dir, cid, {"style": edits.get("style")}):
            failed += 1
    write_json(state, {"state": "done" if not failed else "failed", "done": len(ids), "total": len(ids), "failed": failed,
                       "error": f"{failed} of {len(ids)} shorts couldn't be made again. Try those once more." if failed else None,
                       "started": started, "updated": time.time()})


def fmt_s(t: float) -> str:
    return f"{int(t // 60)}:{int(t % 60):02d}"


if __name__ == "__main__":
    main()
