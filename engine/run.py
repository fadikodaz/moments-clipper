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

import argparse
import json
import os
import re
import shutil
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from make_short import LAYOUTS, render_short, roman_line
from pick import pick
from signals import extract_audio, fmt, loudness_per_second
from transcribe import load_key, transcribe

# Share of the progress bar each step takes (roughly its share of the waiting time).
WEIGHTS = {1: 0.03, 2: 0.22, 3: 0.01, 4: 0.19, 5: 0.55}
LABELS = {1: "Reading the audio", 2: "Listening to what you said", 3: "Measuring the action", 4: "Picking the best moments", 5: "Making your shorts"}


class Status:
    """Writes status.json atomically so the website never reads a half-written file."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self.started = time.time()

    def write(self, state: str, step: int = 0, part: float = 0.0, detail: str = "", error: str | None = None) -> None:
        done = sum(w for s, w in WEIGHTS.items() if s < step) + WEIGHTS.get(step, 0) * max(0.0, min(1.0, part))
        data = {"state": state, "step": step, "steps": len(WEIGHTS), "label": LABELS.get(step, ""), "detail": detail,
                "progress": 1.0 if state == "done" else round(done, 3), "started": self.started, "updated": time.time(), "error": error}
        with self.lock:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data), encoding="utf-8")
            os.replace(tmp, self.path)


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "clip"


def run(video: Path, out_dir: Path, layout: str, top: int, status: Status) -> None:
    key = load_key()
    sig = video.parent / "signals"
    sig.mkdir(exist_ok=True)
    timings = {}
    t_all = time.perf_counter()

    status.write("running", 1)
    t = time.perf_counter()
    wav = sig / f"{video.stem}.audio.wav"
    extract_audio(video, wav)
    timings["1_audio"] = time.perf_counter() - t

    status.write("running", 2, 0, "Starting")
    t = time.perf_counter()
    tfile = sig / f"{video.stem}.transcript.json"
    transcript = (json.loads(tfile.read_text(encoding="utf-8")) if tfile.exists()
                  else transcribe(video, key, on_piece=lambda i, n: status.write("running", 2, i / n, f"Part {i} of {n}")))
    timings["2_listen"] = time.perf_counter() - t

    status.write("running", 3)
    t = time.perf_counter()
    loud = loudness_per_second(wav)
    timings["3_measure"] = time.perf_counter() - t

    status.write("running", 4, 0, "Finding candidates")
    t = time.perf_counter()
    picks = pick(video, key, transcript, loud, top=top,
                 on_batch=lambda i, n: status.write("running", 4, i / n, f"Checked {i * 3} of {n * 3} moments"))["picks"]
    timings["4_pick"] = time.perf_counter() - t
    if not picks:
        raise RuntimeError("No moments were good enough to post. Try a longer recording with more action or talking.")

    lock = threading.Lock()
    ready: list[dict] = []
    failed = 0

    def to_clip(p: dict, r: dict) -> dict:
        # Shape matches the Clip type in src/lib so the website can show it directly.
        sc = p.get("scores", {})
        return {
            "id": f"c{p['rank']:02d}", "rank": p["rank"], "file": r["file"], "poster": r["poster"], "title": p.get("title"), "score": p.get("overall"),
            "startSec": p["start"], "durSec": round(p["end"] - p["start"], 2),
            "tags": p.get("tags", []), "reason": p.get("reason"), "hook": r["hook"] or roman_line(key, p.get("hook", "")),
            "words": " ".join(w["text"] for w in r["words"]),
            "sub": {k: sc.get(k) for k in ("hook", "action", "reaction", "clarity")},
        }

    def save(final: bool) -> None:
        """Written after every finished short, so the website can show them one by one."""
        clips = sorted(ready, key=lambda c: c["rank"])
        summary = {"video": video.name, "duration": fmt(len(loud)), "durationSec": len(loud), "layout": layout,
                   "expected": len(picks), "complete": final, "timings_s": {k: round(v, 1) for k, v in timings.items()}, "clips": clips}
        tmp = out_dir / "clips.tmp"
        tmp.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, out_dir / "clips.json")

    status.write("running", 5, 0, f"0 of {len(picks)} ready")
    t = time.perf_counter()

    def make(p: dict) -> None:
        nonlocal failed
        name = f"{p['rank']:02d}_{slug(p.get('title', 'clip'))}"
        res = None
        for attempt in (1, 2):  # one retry: a single failed cut should not cost the whole job
            try:
                res = render_short(video, p["start"], p["end"] - p["start"], out_dir, name, key, transcript, p.get("hook"), layout)
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

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(make, picks))
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
    ap.add_argument("video", type=Path)
    ap.add_argument("--out", type=Path, help="output folder (default: <video folder>/output/<name>)")
    ap.add_argument("--layout", choices=LAYOUTS, default="top-right", help="where the facecam is, or none")
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--fresh", action="store_true", help="ignore saved audio/transcript and redo every step")
    a = ap.parse_args()
    video = a.video.resolve()
    out_dir = (a.out or video.parent / "output" / video.stem).resolve()
    if a.fresh:
        for f in (video.parent / "signals").glob(f"{video.stem}.*"):
            f.unlink()
        shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    status = Status(out_dir / "status.json")
    try:
        run(video, out_dir, a.layout, a.top, status)
    except BaseException as e:  # includes sys.exit from helpers, so the website always learns the job stopped
        msg = str(e) or e.__class__.__name__
        status.write("failed", 0, 0, "", msg[-600:])
        traceback.print_exc()
        raise SystemExit(1)


if __name__ == "__main__":
    main()
