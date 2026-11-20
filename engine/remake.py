"""
Make one finished short again with the changes from the Edit tab on the website.

Usage:  python remake.py <job_dir> <clip_id> <edits.json>
edits:  {"startDelta": -3, "endDelta": 5, "hook": "text shown first", "layout": "facecam" | "gameplay" | "full",
         "captions": "bold" | "simple" | "none", "lines": [{"from": 0, "to": 5, "text": "fixed words"}]}
        "lines" fix caption words: from/to index the short's current words (clip["words"] split on spaces).
Writes: clips/remake-<clip_id>.json while working ("running", then "done" or "failed"),
        then the new short under a new file name, updates clips.json and removes the old files.
"""

import quiet  # noqa: F401  (must come first: hides helper windows on Windows)
import json
import os
import re
import sys
import time
import traceback
from pathlib import Path

from fetch import remote_source
from make_short import clip_caption_words, render_short
from transcribe import load_key

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


def main() -> None:
    job_dir, clip_id, edits_file = Path(sys.argv[1]).resolve(), sys.argv[2], Path(sys.argv[3])
    out = job_dir / "clips"
    state_file = out / f"remake-{clip_id}.json"
    started = time.time()

    def status(state: str, error: str | None = None) -> None:
        write_json(state_file, {"state": state, "error": error, "started": started, "updated": time.time(), "pid": os.getpid()})

    try:
        status("running")
        edits = json.loads(edits_file.read_text(encoding="utf-8"))
        summary = json.loads((out / "clips.json").read_text(encoding="utf-8"))
        meta = json.loads((job_dir / "meta.json").read_text(encoding="utf-8"))
        clip = next((c for c in summary["clips"] if c["id"] == clip_id), None)
        if not clip:
            raise RuntimeError("This short no longer exists.")
        tfile = next((job_dir / "signals").glob("*.transcript.json"), None)
        if not tfile:
            raise RuntimeError("The transcript of this video is missing, so the short can't be made again.")
        transcript = json.loads(tfile.read_text(encoding="utf-8"))
        key = load_key()

        start, dur = float(clip["startSec"]), float(clip["durSec"])
        total = float(summary.get("durationSec") or start + dur)
        ds = max(-MAX_SHIFT, min(MAX_SHIFT, float(edits.get("startDelta", 0))))
        de = max(-MAX_SHIFT, min(MAX_SHIFT, float(edits.get("endDelta", 0))))
        new_start, new_end = max(0.0, start + ds), min(total, start + dur + de)
        if new_end - new_start < MIN_LENGTH:
            raise RuntimeError(f"The short would be shorter than {MIN_LENGTH} seconds. Move the start or end less.")
        length = new_end - new_start

        # Caption words: the current ones (with the user's fixes), moved to the new start,
        # plus freshly converted words for any seconds added at either end.
        base = clip.get("capWords") or clip_caption_words(key, transcript, start, dur)
        words = apply_lines(timed_tokens(clip, base), edits.get("lines") or [])
        shift = new_start - start
        words = [{**w, "start": round(w["start"] - shift, 2), "end": round(min(length, w["end"] - shift), 2)}
                 for w in words if 0 <= w["start"] - shift < length]
        if new_start < start:
            words = clip_caption_words(key, transcript, new_start, start - new_start) + words
        if new_end > start + dur:
            tail = clip_caption_words(key, transcript, start + dur, new_end - start - dur)
            words += [{**w, "start": round(w["start"] + start + dur - new_start, 2), "end": round(w["end"] + start + dur - new_start, 2)} for w in tail]

        # Layout: the facecam box found when the project was made is reused.
        box = summary.get("facecam")
        choice = edits.get("layout") or clip.get("layout") or "facecam"
        if choice == "gameplay":
            layout = "none"
        elif choice == "full":
            layout = "full"
        else:
            layout = "auto" if box else (summary.get("layout") if summary.get("layout") not in (None, "auto", "none", "full") else "top-right")
        captions = edits.get("captions") if edits.get("captions") in ("bold", "simple", "none") else clip.get("captions", "bold")
        hook = str(edits.get("hook", clip.get("hook") or "")).strip()[:80] or None

        # Where to cut from: the uploaded file, a full download of the link, or YouTube directly.
        video = next((p for p in sorted(job_dir.iterdir()) if VIDEO.match(p.name)), None)
        remote = None
        if not video:
            if not meta.get("url"):
                raise RuntimeError("The original video is missing, so the short can't be made again.")
            remote = remote_source(meta["url"])

        n = int(clip.get("edits", 0)) + 1
        name = re.sub(r"-e\d+$", "", Path(clip["file"]).stem) + f"-e{n}"
        res = render_short(video, new_start, length, out, name, key, transcript, hook, layout, remote, box, captions, words_override=words)

        # Save under the new name (so browsers don't show the old cached video), then remove the old files.
        summary = json.loads((out / "clips.json").read_text(encoding="utf-8"))
        clip = next(c for c in summary["clips"] if c["id"] == clip_id)
        old = [clip["file"], clip["poster"], Path(clip["file"]).with_suffix(".ass").name]
        clip.update({"file": res["file"], "poster": res["poster"], "startSec": round(new_start, 2), "durSec": round(length, 2),
                     "hook": hook or "", "words": " ".join(w["text"] for w in words), "capWords": words,
                     "layout": choice, "captions": captions, "edits": n})
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
        status("done")
        print(f"Remade {clip_id}: {fmt_s(new_start)} for {length:.1f} s, layout {layout}, captions {captions}", flush=True)
    except BaseException as e:
        traceback.print_exc()
        msg = str(e) or e.__class__.__name__
        status("failed", "Making the short again failed while cutting the video. Try once more." if msg.startswith("FFmpeg") else msg[-400:])
        raise SystemExit(1)
    finally:
        edits_file.unlink(missing_ok=True)


def fmt_s(t: float) -> str:
    return f"{int(t // 60)}:{int(t % 60):02d}"


if __name__ == "__main__":
    main()
