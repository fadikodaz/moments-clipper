"""
Step 1 + 3 of the clip engine: find candidate moments from free signals only (no AI yet).

  1. Audio:   pull the soundtrack out as 16 kHz mono WAV (also what speech-to-text needs later).
  3. Measure: loudness per second (shouting, explosions, music drops) and
              hard camera cuts (fast action, crashes, scene changes).

Then score every second, and pick the strongest non-overlapping windows as candidate clips.

Usage:  python signals.py <video> [--top 10]
Writes: <video folder>/signals/<name>.audio.wav, <name>.moments.json
"""

import argparse
import json
import re
import subprocess
import sys
import time
import wave
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000
SCENE_THRESHOLD = 0.30   # 0..1, how different two frames must be to count as a cut
CLIP_MIN, CLIP_MAX = 25, 55  # seconds; shorts work best in this range
PAD_BEFORE = 12          # seconds of build-up before the peak, so the clip has context
SKIP_EDGES = 60          # seconds ignored at start/end: channel intros and outros are loud but not moments


def fmt(sec: float) -> str:
    sec = int(round(sec))
    h, m, s = sec // 3600, sec % 3600 // 60, sec % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def extract_audio(video: Path, out: Path) -> None:
    if out.exists():
        return
    r = run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", str(out)])
    if r.returncode:
        sys.exit(f"Audio extraction failed:\n{r.stderr}")


def loudness_per_second(wav: Path) -> np.ndarray:
    """Loudness in dB for each second of audio (RMS level)."""
    with wave.open(str(wav)) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    secs = len(data) // SAMPLE_RATE
    frames = data[: secs * SAMPLE_RATE].reshape(secs, SAMPLE_RATE)
    rms = np.sqrt((frames ** 2).mean(axis=1) + 1e-12)
    return 20 * np.log10(rms)


def scene_cuts(video: Path) -> list[float]:
    """Timestamps of hard cuts. Video is shrunk and sampled at 10 fps to keep this fast."""
    r = run([
        "ffmpeg", "-v", "info", "-nostats", "-i", str(video), "-an",
        "-vf", f"fps=10,scale=160:-2,select='gt(scene,{SCENE_THRESHOLD})',showinfo",
        "-f", "null", "-",
    ])
    return [float(t) for t in re.findall(r"pts_time:([\d.]+)", r.stderr)]


def zscore(x: np.ndarray) -> np.ndarray:
    return (x - np.median(x)) / (x.std() + 1e-9)


def smooth(x: np.ndarray, width: int) -> np.ndarray:
    k = np.ones(width) / width
    return np.convolve(x, k, mode="same")


def score_seconds(loud: np.ndarray, cuts: list[float]) -> dict[str, np.ndarray]:
    n = len(loud)
    cut_count = np.zeros(n)
    for t in cuts:
        if int(t) < n:
            cut_count[int(t)] += 1
    # How loud compared with this video's normal level (each video has its own baseline).
    loud_z = zscore(smooth(loud, 3))
    # Sudden jumps: quiet then loud is what a reaction or an explosion sounds like.
    jump = np.maximum(0, loud - np.concatenate([np.full(5, loud[:5].mean()), smooth(loud, 10)[:-5]]))
    jump_z = zscore(smooth(jump, 3))
    # Busy editing / camera: many cuts within ~10 s.
    cuts_z = zscore(smooth(cut_count, 10))
    total = 0.5 * loud_z + 0.3 * jump_z + 0.2 * cuts_z
    return {"total": smooth(total, 5), "loud_z": loud_z, "jump_z": jump_z, "cuts": smooth(cut_count, 10) * 10}


def pick_moments(s: dict[str, np.ndarray], loud: np.ndarray, top: int) -> list[dict]:
    total = s["total"].copy()
    n = len(total)
    taken = np.zeros(n, dtype=bool)
    if n > SKIP_EDGES * 4:
        taken[:SKIP_EDGES] = True
        taken[n - SKIP_EDGES:] = True
    moments = []
    for _ in range(top * 4):
        if len(moments) >= top:
            break
        peak = int(np.argmax(np.where(taken, -np.inf, total)))
        if not np.isfinite(total[peak]) or taken[peak]:
            break
        # Grow the clip around the peak while the energy stays above the video's typical level.
        start = max(0, peak - PAD_BEFORE)
        end = peak
        while end < n - 1 and end - start < CLIP_MAX and total[end + 1] > 0:
            end += 1
        end = max(end, min(n - 1, start + CLIP_MIN))
        taken[max(0, start - 10): min(n, end + 10)] = True  # keep clips apart
        reasons = []
        win = slice(start, end + 1)
        if s["loud_z"][win].max() > 2:
            reasons.append("very loud")
        if s["jump_z"][win].max() > 2:
            reasons.append("sudden volume jump")
        if s["cuts"][win].max() >= 3:
            reasons.append(f"{s['cuts'][win].max():.0f} cuts per 10 s")
        moments.append({
            "rank": len(moments) + 1,
            "start": start, "end": end, "peak": peak,
            "start_text": fmt(start), "end_text": fmt(end), "peak_text": fmt(peak),
            "length": end - start,
            "score": round(float(total[win].mean()), 2),
            "peak_db": round(float(loud[win].max()), 1),
            "reasons": reasons or ["above-average energy"],
        })
    return moments


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=Path)
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--cuts", action="store_true", help="also detect camera cuts (slow: decodes the whole video)")
    a = ap.parse_args()
    video = a.video.resolve()
    out_dir = video.parent / "signals"
    out_dir.mkdir(exist_ok=True)
    wav = out_dir / f"{video.stem}.audio.wav"
    timings = {}

    t = time.perf_counter()
    extract_audio(video, wav)
    timings["1_extract_audio_s"] = round(time.perf_counter() - t, 1)

    t = time.perf_counter()
    loud = loudness_per_second(wav)
    timings["3a_loudness_s"] = round(time.perf_counter() - t, 1)

    t = time.perf_counter()
    # Off by default: in tests gameplay had very few hard cuts and decoding took 12+ minutes.
    cuts = scene_cuts(video) if a.cuts else []
    timings["3b_scene_cuts_s"] = round(time.perf_counter() - t, 1)

    t = time.perf_counter()
    s = score_seconds(loud, cuts)
    moments = pick_moments(s, loud, a.top)
    timings["3c_scoring_s"] = round(time.perf_counter() - t, 1)

    result = {
        "video": str(video), "duration": fmt(len(loud)), "seconds": len(loud),
        "scene_cuts_found": len(cuts), "median_loudness_db": round(float(np.median(loud)), 1),
        "timings": timings, "moments": moments,
    }
    (out_dir / f"{video.stem}.moments.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    print(f"Video {result['duration']}, {len(cuts)} cuts, typical loudness {result['median_loudness_db']} dB")
    print("Timings:", timings)
    for m in moments:
        print(f"#{m['rank']:>2}  {m['start_text']:>7} - {m['end_text']:>7}  ({m['length']:>2}s)  peak {m['peak_text']:>7}  score {m['score']:>5}  {', '.join(m['reasons'])}")


if __name__ == "__main__":
    main()
