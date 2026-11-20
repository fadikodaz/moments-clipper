"""
The whole clip engine in one command: long video in, finished vertical shorts out.

  1. Audio      pull the soundtrack out                     (FFmpeg)
  2. Listen     speech to text, a timestamp per word        (Groq Whisper)
  3. Measure    loudness every second                       (numpy)
  4. Pick       AI scores candidate moments, keeps the best (Groq gpt-oss-120b)
  5. Cut        vertical layout + Hinglish captions + hook  (FFmpeg, 2 clips at a time)

Usage:  python run.py <video> [--out DIR] [--layout top-right] [--top 10] [--fresh]
Writes: DIR/status.json  progress, read by the website while the job runs
        DIR/01_title.mp4, 01_title.jpg ...  finished shorts and posters
        DIR/clips.json   what the Clips page shows
"""

import quiet  # noqa: F401  (must come first: hides helper windows on Windows)
import argparse
import json
import os
import re
import shutil
import threading
import time
import traceback

import subprocess

import numpy as np
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from make_short import LAYOUTS, render_short, roman_line
from facecam import find_facecam
from fetch import FetchError, download_audio, download_video, info, is_url, remote_source
from pick import pick
from signals import extract_audio, fmt, loudness_per_second, score_seconds
from style import normalize
from transcribe import load_key, prompt_for, scrub, transcribe

# Share of the progress bar each step takes (roughly its share of the waiting time).
WEIGHTS = {1: 0.03, 2: 0.22, 3: 0.01, 4: 0.19, 5: 0.55}
LINK_WEIGHTS = {1: 0.15, 2: 0.18, 3: 0.01, 4: 0.16, 5: 0.50}  # links spend time downloading the audio first
MAX_LINK_SECONDS = 24 * 3600
MAX_PART_SECONDS = 4 * 3600  # one project reads at most 4 hours; longer streams are made in parts (--from/--to)
LABELS = {1: "Reading the audio", 2: "Listening to what you said", 3: "Measuring the action", 4: "Picking the best moments", 5: "Making your shorts"}


class Status:
    """Writes status.json atomically so the website never reads a half-written file."""

    def __init__(self, path: Path, weights: dict[int, float] = WEIGHTS):
        self.path = path
        self.weights = weights
        self.lock = threading.Lock()
        self.started = time.time()
        self.last: tuple | None = None
        # Heartbeat: a slow step (cutting on a slow connection) must not look like a crash to the website.
        threading.Thread(target=self._beat, daemon=True).start()

    def _beat(self) -> None:
        while True:
            time.sleep(30)
            if self.last and self.last[0] == "running":
                self._last_t = 0  # skip the throttle
                self.write(*self.last)

    def write(self, state: str, step: int = 0, part: float = 0.0, detail: str = "", error: str | None = None) -> None:
        self.last = (state, step, part, detail, error)
        done = sum(w for s, w in self.weights.items() if s < step) + self.weights.get(step, 0) * max(0.0, min(1.0, part))
        data = {"state": state, "step": step, "steps": len(self.weights), "label": LABELS.get(step, ""), "detail": detail,
                "progress": 1.0 if state == "done" else round(done, 3), "part": round(max(0.0, min(1.0, part)), 3), "started": self.started, "updated": time.time(), "error": error}
        with self.lock:
            # Throttle tiny progress updates (downloads report many per second).
            if state == "running" and step == getattr(self, "_last_step", None) and time.time() - getattr(self, "_last_t", 0) < 0.5:
                return
            self._last_step, self._last_t = step, time.time()
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data), encoding="utf-8")
            # On Windows the file can be locked for a moment while the website or antivirus reads it.
            for _ in range(20):
                try:
                    os.replace(tmp, self.path)
                    return
                except PermissionError:
                    time.sleep(0.05)
            print("    could not update status.json (file busy); continuing", flush=True)


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "clip"


def write_timeline(out_dir: Path, data: dict) -> None:
    """Small file the progress page draws: the sound of the whole video plus every moment found."""
    tmp = out_dir / "timeline.tmp"
    tmp.write_text(json.dumps(data), encoding="utf-8")
    for _ in range(20):
        try:
            os.replace(tmp, out_dir / "timeline.json")
            return
        except PermissionError:
            time.sleep(0.05)


def trim_audio(src: Path, part: tuple[float, float], out: Path) -> Path:
    """Just the chosen part of a long recording's sound, so only that part is listened to and read."""
    if not out.exists():
        r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(part[0]), "-to", str(part[1]), "-i", str(src), "-vn", "-ac", "1", "-c:a", "aac", "-b:a", "64k", str(out)],
                           capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(f"Could not cut the chosen part out of the video:\n{r.stderr[-500:]}")
    return out


def run(source: str, out_dir: Path, layout: str, top: int, status: Status, length: str = "auto", count: int | None = None, captions: str = "bold",
        language: str = "hi", campaign: dict | None = None, part: tuple[float, float] | None = None,
        style_raw: dict | None = None, lengths: tuple[float, float] | None = None) -> None:
    """part: (from, to) seconds of a long stream to work on; every time shown to the user stays a time in the full video."""
    key = load_key()
    style = normalize(style_raw, layout, captions)
    timings = {}
    t_all = time.perf_counter()
    link = is_url(source)
    upload: Path | None = None
    t = time.perf_counter()
    status.write("running", 1, 0, "Checking the link" if link else "")

    if link:
        # Links: fetch only the audio now; the picked moments are cut straight from YouTube later.
        job_dir = out_dir.parent
        meta = info(source)
        if meta.get("live_status") in ("is_live", "is_upcoming"):
            raise FetchError("This stream is still live. Paste the link again once it has ended.")
        source_sec = float(meta.get("duration") or 0)
        if source_sec > MAX_LINK_SECONDS:
            raise FetchError("Videos up to 24 hours are supported.")
        if not part and source_sec > MAX_PART_SECONDS:
            raise FetchError(f"This video is {source_sec / 3600:.1f} hours long. Choose a part of up to 4 hours (From and To) and make the rest in another project.")
        title = meta.get("title") or "YouTube video"
        progress = lambda f: status.write("running", 1, f * 0.9, f"Downloading the audio from YouTube, {round(f * 100)}%")
        retry = lambda n, m: status.write("running", 1, 0, f"YouTube refused, trying again ({n} of {m})")
        if part:
            # The whole stream's sound is kept once in a shared folder, so other parts of it start at once.
            cache = job_dir.parent / "_cache"
            have = [f for f in cache.glob(f"{meta['id']}.*") if f.suffix not in (".part", ".ytdl")]
            full = have[0] if have else download_audio(source, cache / meta["id"], progress, retry)
            status.write("running", 1, 0.95, "Cutting out your chosen part")
            video = trim_audio(full, part, job_dir / "source_audio.m4a")
        else:
            video = download_audio(source, job_dir / "source_audio", progress, retry)
    else:
        upload = Path(source).resolve()
        title = upload.name
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(upload)], capture_output=True, text=True)
        source_sec = float(r.stdout.strip() or 0)
        if part:
            status.write("running", 1, 0.2, "Cutting out your chosen part")
        video = trim_audio(upload, part, upload.parent / "source_part.m4a") if part else upload
    offset = float(part[0]) if part else 0.0
    sig = video.parent / "signals"
    sig.mkdir(exist_ok=True)

    wav = sig / f"{video.stem}.audio.wav"
    extract_audio(video, wav)
    timings["1_audio"] = time.perf_counter() - t

    status.write("running", 2, 0, "Starting")
    t = time.perf_counter()
    tfile = sig / f"{video.stem}.transcript.json"
    names = ", ".join(dict.fromkeys(x for x in ((campaign or {}).get("streamer"), (campaign or {}).get("mention")) if x))
    transcript = (json.loads(tfile.read_text(encoding="utf-8")) if tfile.exists()
                  else transcribe(video, key, on_piece=lambda i, n: status.write("running", 2, i / n, f"Part {i} of {n}"),
                                  language=language, prompt=prompt_for(language, names)))
    if language != "hi":
        transcript = scrub(transcript)
    timings["2_listen"] = time.perf_counter() - t

    status.write("running", 3)
    t = time.perf_counter()
    loud = loudness_per_second(wav)
    timings["3_measure"] = time.perf_counter() - t
    # 160 bars for the progress page; louder parts are taller.
    bins = np.array_split(loud, min(160, max(1, len(loud))))
    lv = np.array([b.mean() for b in bins])
    lv = (lv - np.percentile(lv, 5)) / max(1e-6, np.percentile(lv, 99) - np.percentile(lv, 5))
    timeline = {"offsetSec": offset, "durationSec": len(loud), "bars": [round(float(min(1, max(0.06, v))), 3) for v in lv], "moments": []}
    write_timeline(out_dir, timeline)

    def found(new: list[dict]) -> None:
        for m in new:
            try:
                timeline["moments"].append({"start": float(m["start"]), "end": float(m["end"]), "score": m.get("overall"), "title": m.get("title")})
            except (KeyError, TypeError, ValueError):
                pass
        write_timeline(out_dir, timeline)

    status.write("running", 4, 0, "Reading what you said")
    t = time.perf_counter()
    picks = pick(video, key, transcript, loud, top=top, length=length, count=count, on_found=found,
                 on_batch=lambda i, n: status.write("running", 4, i / n, f"Read part {i} of {n}"), language=language, campaign=campaign,
                 lengths=lengths)["picks"]
    # Campaigns that require the streamer's name on screen: make sure every opening line has it.
    mention = ((campaign or {}).get("mention") or "").strip()
    for p in picks:
        if mention and mention.lower() not in (p.get("hook") or "").lower():
            p["hook"] = f"{mention}: {p.get('hook') or p.get('title') or ''}".strip(": ")
    # The timeline now shows only the moments that became shorts.
    timeline["moments"] = [{"id": f"c{p['rank']:02d}", "start": p["start"], "end": p["end"], "score": p.get("overall"), "title": p.get("title")} for p in picks]
    write_timeline(out_dir, timeline)
    timings["4_pick"] = time.perf_counter() - t
    if not picks:
        raise RuntimeError("No moments were good enough to post. Try a longer recording with more action or talking.")
    # From here on, times are seconds in the full video (the part may start hours in).
    loud_z = score_seconds(loud, [])["loud_z"]
    for p in picks:
        # Loudest seconds inside the moment (at most 2, apart from each other): the facecam zooms in there.
        a, b = int(p["start"]), int(p["end"])
        zooms: list[int] = []
        for i in sorted(range(a, min(b, len(loud_z))), key=lambda i: -loud_z[i]):
            if loud_z[i] < 1.8 or len(zooms) == 2:
                break
            if all(abs(i - j) >= 6 for j in zooms):
                zooms.append(i)
        p["zoomSec"] = [[round(i + offset - 0.3, 2), round(i + offset + 1.2, 2)] for i in sorted(zooms)]
        p["start"], p["end"] = round(p["start"] + offset, 2), round(p["end"] + offset, 2)
        p["peak"] = round(float(p.get("peak", (p["start"] + p["end"]) / 2 - offset)) + offset, 2)
    if offset:
        transcript = {**transcript, "words": [{**w, "start": w["start"] + offset, "end": w["end"] + offset} for w in transcript["words"]]}

    lock = threading.Lock()
    ready: list[dict] = []
    failed = 0

    def to_clip(p: dict, r: dict) -> dict:
        # Shape matches the Clip type in src/lib so the website can show it directly.
        sc = p.get("scores", {})
        return {
            "id": f"c{p['rank']:02d}", "rank": p["rank"], "file": r["file"], "poster": r["poster"], "title": p.get("title"), "score": p.get("overall"),
            "startSec": p["start"], "durSec": round(p["end"] - p["start"], 2),
            "tags": p.get("tags", []), "reason": p.get("reason"), "hook": r["hook"] or (roman_line(key, p.get("hook", "")) if language == "hi" else p.get("hook", "")),
            "words": " ".join(w["text"] for w in r["words"]),
            "capWords": r["words"],  # timed caption words, so they can be fixed and the short made again
            "sub": {k: sc.get(k) for k in ("hook", "action", "reaction", "clarity")},
            "layout": "facecam" if box or layout not in ("auto", "none") else "gameplay", "captions": captions,
            "peakSec": p.get("peak"), "zoomSec": p.get("zoomSec", []), "style": r.get("style"), "frame": r.get("frame"),
        }

    def save(final: bool) -> None:
        """Written after every finished short, so the website can show them one by one."""
        clips = sorted(ready, key=lambda c: c["rank"])
        summary = {"video": title, "duration": fmt(len(loud)), "durationSec": len(loud), "layout": layout, "facecam": box,
                   "offsetSec": offset, "sourceSec": source_sec or offset + len(loud), "style": style,
                   "settings": {"length": length, "count": count, "captions": captions, "language": language,
                                "part": list(part) if part else None, "campaign": campaign},
                   "expected": len(picks), "complete": final, "timings_s": {k: round(v, 1) for k, v in timings.items()}, "clips": clips}
        tmp = out_dir / "clips.tmp"
        tmp.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
        for _ in range(20):
            try:
                os.replace(tmp, out_dir / "clips.json")
                break
            except PermissionError:
                time.sleep(0.05)

    status.write("running", 5, 0, f"0 of {len(picks)} ready")
    t = time.perf_counter()
    # Where the shorts are cut from: the uploaded file, or (for links) YouTube's servers directly.
    mode: dict = {"video": upload, "remote": None}
    if link:
        status.write("running", 5, 0, "Connecting to YouTube")
        try:
            mode["remote"] = remote_source(source)
        except FetchError as e:
            print(f"    direct cutting unavailable: {e}", flush=True)

    # Find the facecam once, from frames spread over the whole video.
    box = style["cam"]  # drawn by the user on the set-up screen: no need to search
    if not box and style["layout"] in ("top", "bottom", "pip") and not style["nocam"] and layout != "none":
        status.write("running", 5, 0, "Finding your facecam")
        if mode["remote"]:
            rs = mode["remote"]
            input_for = lambda t: ["-ss", str(t + offset), "-headers", rs["headers"], "-i", rs["video"]]
        else:
            src = mode["video"] if mode["video"] else video
            input_for = lambda t: ["-ss", str(t + offset), "-i", str(src)]
        try:
            box = find_facecam(len(loud), input_for, layout)
            if layout == "auto" and not box:
                print("    no facecam found: shorts use the gameplay only", flush=True)
        except Exception as e:  # detection is a nice-to-have; the default box still works
            print(f"    facecam detection failed: {e}", flush=True)
        print(f"    facecam: {box or 'not found, using the default corner box'}", flush=True)

    def make(p: dict) -> bool:
        nonlocal failed
        name = f"{p['rank']:02d}_{slug(p.get('title', 'clip'))}"
        res = None
        for attempt in (1, 2):  # one retry: a single failed cut should not cost the whole job
            try:
                res = render_short(mode["video"], p["start"], p["end"] - p["start"], out_dir, name, key, transcript, p.get("hook"), layout, mode["remote"], box, captions,
                                   language=language, style=style, peak=p["peak"] - p["start"],
                                   zooms=[(z0 - p["start"], z1 - p["start"]) for z0, z1 in p.get("zoomSec", [])])
                break
            except RuntimeError as e:
                print(f"    #{p['rank']} attempt {attempt} failed: {str(e)[:300]}", flush=True)
        with lock:
            if res is None:
                failed += 1
            else:
                ready.append(to_clip(p, res))
                save(final=False)
                print(f"    #{p['rank']} done in {sum(res['timings'].values()):.0f} s: {p.get('title')}", flush=True)
            n = len(ready) + failed
            status.write("running", 5, n / len(picks), f"{len(ready)} of {len(picks)} ready")
        return res is not None

    rest = picks
    if link:
        # The first short doubles as a test: if YouTube refuses partial reads, get the full video once.
        ok = mode["remote"] is not None and make(picks[0])
        if not ok:
            failed = 0
            mode["remote"] = None
            mode["video"] = download_video(source, out_dir.parent / "source_video",
                                           lambda f: status.write("running", 5, 0, f"YouTube blocked quick cutting, downloading the full video: {round(f * 100)}%"))
        else:
            rest = picks[1:]
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(make, rest))
    if not ready:
        raise RuntimeError("None of the shorts could be made. See engine.log for the FFmpeg error.")
    timings["5_cut"] = time.perf_counter() - t
    timings["total"] = time.perf_counter() - t_all
    save(final=True)
    status.write("done", 5, 1, f"{len(ready)} shorts ready")
    clips = sorted(ready, key=lambda c: c["rank"])
    timings = {k: round(v, 1) for k, v in timings.items()}
    print("\nTimings (seconds):", timings)
    for c in clips:
        print(f"  {c['id']}  {c['score']:>3}  {fmt(c['startSec']):>6}  {c['durSec']:>4.0f}s  {c['title']}  |  {c['hook']}")
    print(f"\nShorts saved in {out_dir}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="a video file, or a YouTube link")
    ap.add_argument("--out", type=Path, help="output folder (default: <video folder>/output/<name>; required for links)")
    ap.add_argument("--layout", choices=LAYOUTS, default="auto", help="auto finds the facecam; or a corner, or none")
    ap.add_argument("--length", choices=("auto", "short", "long"), default="auto", help="auto 60-150 s, short 30-60 s, long 60-180 s")
    ap.add_argument("--count", type=int, default=0, help="exact number of shorts (0 = about one per 5 minutes)")
    ap.add_argument("--captions", choices=("bold", "simple", "none"), default="bold")
    ap.add_argument("--language", choices=("hi", "en"), default="hi", help="hi: Hindi/Hinglish stream, en: English stream")
    ap.add_argument("--campaign", type=Path, help="JSON file with clipping-campaign rules (streamer, mention, lookFor, avoid)")
    ap.add_argument("--from", dest="part_from", type=float, help="only use the video from this second ...")
    ap.add_argument("--to", dest="part_to", type=float, help="... to this second (at most 4 hours per project)")
    ap.add_argument("--style", type=Path, help="JSON file with the look of the shorts (style.py)")
    ap.add_argument("--min-len", type=float, help="shortest short in seconds (overrides --length)")
    ap.add_argument("--max-len", type=float, help="longest short in seconds")
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--fresh", action="store_true", help="ignore saved audio/transcript and redo every step")
    a = ap.parse_args()
    link = is_url(a.source)
    if link and not a.out:
        ap.error("--out is required for links")
    video = None if link else Path(a.source).resolve()
    out_dir = (a.out or video.parent / "output" / video.stem).resolve()
    if a.fresh:
        if video:
            for f in (video.parent / "signals").glob(f"{video.stem}.*"):
                f.unlink()
        shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    status = Status(out_dir / "status.json", LINK_WEIGHTS if link else WEIGHTS)
    try:
        part = None
        if a.part_from is not None or a.part_to is not None:
            lo, hi = a.part_from or 0.0, a.part_to
            if hi is None or hi - lo < 60 or hi - lo > MAX_PART_SECONDS:
                raise ValueError("Choose a part between 1 minute and 4 hours long.")
            part = (lo, hi)
        campaign = json.loads(a.campaign.read_text(encoding="utf-8")) if a.campaign else None
        style_raw = json.loads(a.style.read_text(encoding="utf-8")) if a.style else None
        lengths = None
        if a.min_len or a.max_len:
            lo = max(10.0, a.min_len or 30.0)
            lengths = (lo, max(lo + 10, min(180.0, a.max_len or lo + 60)))
        run(a.source, out_dir, a.layout, max(a.top, a.count), status, a.length, a.count or None, a.captions, a.language, campaign, part,
            style_raw, lengths)
    except BaseException as e:  # includes sys.exit from helpers, so the website always learns the job stopped
        msg = str(e) or e.__class__.__name__
        status.write("failed", 0, 0, "", msg[-600:])
        traceback.print_exc()
        raise SystemExit(1)


if __name__ == "__main__":
    main()
