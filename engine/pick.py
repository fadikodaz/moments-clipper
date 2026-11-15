"""
Step 4 of the clip engine: the AI picks the best moments.

  1. Loudness finds ~24 rough candidate spots (cheap, no AI).
  2. For each spot the AI reads what was said ~35 s before and after, with markers for loud seconds.
  3. It decides keep/skip, exact start and end (from line timestamps), title, reason, opening line,
     tags and four sub-scores. Boundaries are then snapped to word edges so speech is never cut mid-word.
  4. Overlapping picks are merged and the best are returned.

Usage:  python pick.py <video> [--top 10] [--candidates 24]
Needs:  signals/<name>.audio.wav (signals.py) and signals/<name>.transcript.json (transcribe.py)
Writes: signals/<name>.picks.json
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np

from signals import SKIP_EDGES, fmt, loudness_per_second, score_seconds
from llm import MODEL, chat_json
from transcribe import load_key

CONTEXT = 35          # seconds of transcript shown before and after each candidate peak
BATCH = 3             # candidates per AI call (fewer calls = less repeated instructions)
CLIP_MIN, CLIP_MAX = 15, 60
MIN_OVERALL = 50      # below this the AI judged it not worth posting

SYSTEM = """You are the clip editor for a gaming-stream clipping tool. Viewers scroll Shorts/TikTok/Reels;
a clip must grab attention in the first 2 seconds and make sense without the rest of the stream.
You get transcript windows from a Hindi/Hinglish GTA streamer. Lines look like "[612.4-615.0] text"
(seconds into the video). A line marked LOUD had a big volume spike (action, explosion, shouting).

For EACH candidate decide:
- Always fill every field for every candidate, even weak ones; the scores decide what gets used.
  Filler, menu talk, sponsor talk, intros/outros and stretches with no clear moment get low scores (under 40).
- start/end: seconds taken from line timestamps. Start right before the hook (not mid-sentence),
  end right after the payoff. Length 15-60 s.
- title: short English title (max 7 words) describing what happens, no clickbait words like "insane".
- reason: one English sentence: why this works as a clip, concrete.
- hook: opening line for the top of the short, max 8 words, casual Roman Hinglish.
- tags: 1-3 from: Police chase, Shootout, Heist, Crash, Stunt, Funny, Fail, Reaction, Story, Tension.
- scores 0-100: hook (first 3 s grab), action (what happens on screen), reaction (streamer's energy/humour),
  clarity (understandable alone). overall = your honest judgement, not an average. Be strict: most clips 50-80.
Return only JSON: {"results":[{"id":..,"start":..,"end":..,"title":"..","reason":"..","hook":"..","tags":[..],"scores":{"hook":..,"action":..,"reaction":..,"clarity":..},"overall":..}, ...]}
One result per candidate id, same ids as given."""


def find_candidates(loud: np.ndarray, n_cand: int) -> list[int]:
    total = score_seconds(loud, [])["total"].copy()
    n = len(total)
    blocked = np.zeros(n, dtype=bool)
    blocked[:SKIP_EDGES] = blocked[n - SKIP_EDGES:] = True
    peaks = []
    while len(peaks) < n_cand:
        masked = np.where(blocked, -np.inf, total)
        p = int(np.argmax(masked))
        if not np.isfinite(masked[p]):
            break
        peaks.append(p)
        blocked[max(0, p - 30): p + 30] = True
    return sorted(peaks)


def window_text(peak: int, segments: list[dict], loud_z: np.ndarray) -> str:
    lo, hi = peak - CONTEXT, peak + CONTEXT
    lines = []
    for s in segments:
        if s["end"] < lo or s["start"] > hi:
            continue
        a, b = int(s["start"]), int(min(len(loud_z) - 1, s["end"]))
        mark = " LOUD" if b >= a and loud_z[a: b + 1].max() > 1.5 else ""
        lines.append(f"[{s['start']:.1f}-{s['end']:.1f}]{mark} {s['text']}")
    return "\n".join(lines) or "(no speech in this window)"


def ask(key: str, user: str) -> dict:
    return chat_json(key, [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}])


def snap(start: float, end: float, words: list[dict]) -> tuple[float, float]:
    """Move edges to word boundaries so the clip never starts or ends mid-word."""
    inside = [w for w in words if w["end"] > start and w["start"] < end]
    if inside:
        start = min(start, inside[0]["start"]) - 0.2
        end = max(end, inside[-1]["end"]) + 0.4
    return max(0.0, round(start, 2)), round(end, 2)


def pick(video: Path, key: str, transcript: dict, loud: np.ndarray, top: int = 10, n_candidates: int = 16, on_batch=None) -> dict:
    sig = video.parent / "signals"
    loud_z = score_seconds(loud, [])["loud_z"]

    t0 = time.perf_counter()
    peaks = find_candidates(loud, n_candidates)
    print(f"{len(peaks)} candidate spots from loudness")

    results = []
    for b in range(0, len(peaks), BATCH):
        chunk = peaks[b: b + BATCH]
        user = "\n\n".join(f"### Candidate id={p} (peak at {p} s = {fmt(p)})\n{window_text(p, transcript['segments'], loud_z)}" for p in chunk)
        t = time.perf_counter()
        res = ask(key, user).get("results", [])
        print(f"  batch {b // BATCH + 1}: {len(res)} answers, {sum(1 for x in res if float(x.get('overall', 0)) >= MIN_OVERALL)} worth posting, {time.perf_counter() - t:.1f} s")
        results.extend(res)
        if on_batch:
            on_batch(b // BATCH + 1, (len(peaks) + BATCH - 1) // BATCH)

    picks = []
    for x in results:
        try:
            if float(x.get("overall", 0)) < MIN_OVERALL:
                continue
            s, e = float(x["start"]), float(x["end"])
            if e - s < CLIP_MIN:
                e = s + CLIP_MIN
            if e - s > CLIP_MAX:
                e = s + CLIP_MAX
            s, e = snap(s, e, transcript["words"])
            picks.append({**x, "start": s, "end": e})
        except (KeyError, TypeError, ValueError):
            continue

    # Best first; drop picks that share more than 3 s with a better one (same moment, two cuts).
    picks.sort(key=lambda p: p.get("overall", 0), reverse=True)
    final = []
    for p in picks:
        if all(min(p["end"], q["end"]) - max(p["start"], q["start"]) < 3 for q in final):
            final.append(p)
    final = final[:top]
    for i, p in enumerate(final, 1):
        p.update(rank=i, start_text=fmt(p["start"]), end_text=fmt(p["end"]), length=round(p["end"] - p["start"]))

    out = {"video": str(video), "model": MODEL, "candidates": len(peaks), "kept_by_ai": len(picks), "seconds_taken": round(time.perf_counter() - t0, 1), "picks": final}
    (sig / f"{video.stem}.picks.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  AI kept {len(picks)} of {len(peaks)}, returning top {len(final)}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=Path)
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--candidates", type=int, default=16)
    a = ap.parse_args()
    video = a.video.resolve()
    sig = video.parent / "signals"
    transcript = json.loads((sig / f"{video.stem}.transcript.json").read_text(encoding="utf-8"))
    out = pick(video, load_key(), transcript, loudness_per_second(sig / f"{video.stem}.audio.wav"), a.top, a.candidates)
    final = out["picks"]
    for p in final:
        sc = p.get("scores", {})
        print(f"#{p['rank']:>2} {p['start_text']:>6}-{p['end_text']:<6} {p['length']:>2}s  {p.get('overall'):>3}  "
              f"h{sc.get('hook')} a{sc.get('action')} r{sc.get('reaction')} c{sc.get('clarity')}  {p.get('title')}")
        print(f"      why: {p.get('reason')}\n      hook: {p.get('hook')}   tags: {', '.join(p.get('tags', []))}")


if __name__ == "__main__":
    main()
