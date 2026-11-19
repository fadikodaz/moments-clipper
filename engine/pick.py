"""
Step 4 of the clip engine: the AI picks the best moments.

  1. The transcript is cut into ~8-minute parts (with 1 minute of overlap so no moment falls in a gap).
  2. The AI reads each whole part, with LOUD markers where the volume spiked, and proposes up to 3
     moments of 60-150 s: start on the hook, end after the payoff, with title, reason, opening line,
     tags and four sub-scores.
  3. Edges are moved to sentence boundaries (never mid-sentence), lengths are enforced,
     overlapping picks are merged, and the best are returned.

Usage:  python pick.py <video> [--top 10]
Needs:  signals/<name>.audio.wav (signals.py) and signals/<name>.transcript.json (transcribe.py)
Writes: signals/<name>.picks.json
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np

from llm import MODEL, chat_json
from signals import SKIP_EDGES, fmt, loudness_per_second, score_seconds
from transcribe import load_key

PART = 8 * 60          # seconds of video the AI reads at once
OVERLAP = 60
PER_PART = 3           # moments the AI may propose per part
CLIP_MIN, CLIP_MAX = 60, 150
MIN_OVERALL = 55       # below this the AI judged it not worth posting
SECONDS_PER_SHORT = 5 * 60  # about one short per 5 minutes of video, so shorts don't overlap in content

LENGTHS = {"auto": (60, 150), "short": (30, 60), "long": (60, 180)}

SYSTEM_TEMPLATE = """You are the clip editor for a gaming-stream clipping tool. Viewers scroll Shorts/TikTok/Reels;
a clip must grab attention in the first 2 seconds, hold it, and make sense without the rest of the stream.
You read a part of a transcript from a Hindi/Hinglish gaming streamer. Lines look like "[612-615] text"
(seconds into the video). LOUD marks a big volume spike (action, explosion, shouting, laughter).

Propose up to {per_part} moments from this part that would each make a great standalone short.
Good moments: a fail or win with a strong reaction, a funny exchange, a chase or fight with a payoff,
a surprising twist, a story with a punchline. Skip greetings, intros/outros, sponsor or subscribe talk,
menu/loading talk, and slow explaining with no payoff. Fewer strong moments beat more weak ones;
return an empty list if nothing is good.

For each moment:
- start/end: seconds taken from line timestamps. Length {lo}-{hi} seconds.
  Start on the line that sets up the moment (the hook), never mid-sentence or mid-joke.
  End right after the payoff and reaction, not in the middle of a sentence.
- title: short English title (max 7 words) saying what happens. No clickbait words like "insane".
- reason: one English sentence: why this works as a short, concrete.
- hook: opening line for the top of the short, max 8 words, casual Roman Hinglish (English letters only).
- tags: 1-3 from: Police chase, Shootout, Heist, Crash, Stunt, Race, Funny, Fail, Win, Reaction, Story, Tension.
- scores 0-100: hook (first 3 s grab), action (what happens on screen), reaction (streamer's energy/humour),
  clarity (understandable alone). overall = your honest judgement, not an average. Be strict: most moments 55-80.
Return only JSON: {{"moments":[{{"start":..,"end":..,"title":"..","reason":"..","hook":"..","tags":[..],"scores":{{"hook":..,"action":..,"reaction":..,"clarity":..}},"overall":..}}]}}"""


def part_text(lo: float, hi: float, segments: list[dict], loud_z: np.ndarray) -> str:
    lines = []
    for s in segments:
        if s["end"] < lo or s["start"] > hi or not s["text"].strip():
            continue
        a, b = int(s["start"]), int(min(len(loud_z) - 1, s["end"]))
        mark = " LOUD" if b >= a and loud_z[a: b + 1].max() > 1.5 else ""
        lines.append(f"[{int(s['start'])}-{int(round(s['end']))}]{mark} {s['text'].strip()}")
    return "\n".join(lines)


def fit(start: float, end: float, segments: list[dict], total: float, CLIP_MIN: float = CLIP_MIN, CLIP_MAX: float = CLIP_MAX) -> tuple[float, float]:
    """Snap to sentence edges, then grow or trim whole sentences until the length is within CLIP_MIN..CLIP_MAX."""
    segs = sorted((s for s in segments if s["text"].strip()), key=lambda s: s["start"])
    if not segs:
        return start, min(total, max(end, start + CLIP_MIN))
    # Start at the beginning of the sentence the AI's start falls in (or the next one).
    i = next((k for k, s in enumerate(segs) if s["end"] > start), len(segs) - 1)
    start = min(start, segs[i]["start"])
    # End at the end of the sentence the AI's end falls in.
    j = max((k for k, s in enumerate(segs) if s["start"] < end), default=i)
    j = max(j, i)
    end = max(end, segs[j]["end"])
    # Too short: add the following sentences (the reaction), then earlier ones (the setup).
    while end - start < CLIP_MIN and j + 1 < len(segs) and segs[j + 1]["end"] - start <= CLIP_MAX:
        j += 1
        end = segs[j]["end"]
    while end - start < CLIP_MIN and i > 0 and end - segs[i - 1]["start"] <= CLIP_MAX:
        i -= 1
        start = segs[i]["start"]
    if end - start < CLIP_MIN:  # little speech here: pad with game time
        end = min(total, start + CLIP_MIN)
    # Too long: drop whole sentences from the end.
    while end - start > CLIP_MAX and j > i and segs[j - 1]["end"] - start >= CLIP_MIN:
        j -= 1
        end = segs[j]["end"]
    end = min(end, start + CLIP_MAX, total)
    return max(0.0, round(start - 0.3, 2)), round(min(total, end + 0.6), 2)


def pick(video: Path, key: str, transcript: dict, loud: np.ndarray, top: int = 10, n_candidates: int = 0, on_batch=None,
         length: str = "auto", count: int | None = None, on_found=None) -> dict:
    """length: auto/short/long (see LENGTHS). count: exact number of shorts, or None for about one per 5 minutes.
    on_found(moments): called after each part with every moment accepted so far, for the live timeline."""
    sig = video.parent / "signals"
    lo_len, hi_len = LENGTHS.get(length, LENGTHS["auto"])
    per_part = PER_PART if not count else max(PER_PART, min(6, -(-count * 2 // max(1, round(len(loud) / (PART - OVERLAP))))))
    system = SYSTEM_TEMPLATE.format(lo=lo_len, hi=hi_len, per_part=per_part)
    loud_z = score_seconds(loud, [])["loud_z"]
    total = float(len(loud))
    t0 = time.perf_counter()

    lo_edge, hi_edge = (SKIP_EDGES, total - SKIP_EDGES) if total > SKIP_EDGES * 4 else (0.0, total)
    starts = list(np.arange(lo_edge, max(lo_edge + 1, hi_edge - OVERLAP), PART - OVERLAP))
    print(f"  reading {len(starts)} parts of about {PART // 60} min")

    proposals = []
    for n, lo in enumerate(starts, 1):
        hi = min(hi_edge, lo + PART)
        text = part_text(lo, hi, transcript["segments"], loud_z)
        if len(text) > 80:
            res = chat_json(key, [{"role": "system", "content": system},
                                  {"role": "user", "content": f"Part {n} of {len(starts)}: {fmt(lo)} to {fmt(hi)} of a {fmt(total)} video.\n\n{text}"}])
            got = res.get("moments", []) if isinstance(res, dict) else []
            print(f"  part {n}: {len(got)} moments proposed")
            proposals.extend(got)
            if on_found:
                on_found([g for g in got if isinstance(g, dict)])
        if on_batch:
            on_batch(n, len(starts))

    picks = []
    for x in proposals:
        try:
            if float(x.get("overall", 0)) < MIN_OVERALL:
                continue
            s, e = fit(float(x["start"]), float(x["end"]), transcript["segments"], total, lo_len, hi_len)
            if s < lo_edge - 5 or e > hi_edge + 5 or e - s < lo_len - 1:
                continue
            picks.append({**x, "start": s, "end": e})
        except (KeyError, TypeError, ValueError):
            continue

    # Best first; overlapping parts propose the same moment, so drop picks sharing >25% with a better one.
    picks.sort(key=lambda p: float(p.get("overall", 0)), reverse=True)
    final = []
    for p in picks:
        if all(min(p["end"], q["end"]) - max(p["start"], q["start"]) < 0.25 * (p["end"] - p["start"]) for q in final):
            final.append(p)
    limit = count if count else max(3, min(top, round(total / SECONDS_PER_SHORT)))
    final = final[:limit]
    for i, p in enumerate(final, 1):
        p.update(rank=i, start_text=fmt(p["start"]), end_text=fmt(p["end"]), length=round(p["end"] - p["start"]))

    out = {"video": str(video), "model": MODEL, "parts": len(starts), "proposed": len(proposals), "kept_by_ai": len(picks),
           "seconds_taken": round(time.perf_counter() - t0, 1), "picks": final}
    (sig / f"{video.stem}.picks.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  {len(proposals)} proposed, {len(picks)} good enough, returning top {len(final)}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=Path)
    ap.add_argument("--top", type=int, default=10)
    a = ap.parse_args()
    video = a.video.resolve()
    sig = video.parent / "signals"
    transcript = json.loads((sig / f"{video.stem}.transcript.json").read_text(encoding="utf-8"))
    out = pick(video, load_key(), transcript, loudness_per_second(sig / f"{video.stem}.audio.wav"), a.top)
    for p in out["picks"]:
        sc = p.get("scores", {})
        print(f"#{p['rank']:>2} {p['start_text']:>6}-{p['end_text']:<6} {p['length']:>3}s  {p.get('overall'):>3}  "
              f"h{sc.get('hook')} a{sc.get('action')} r{sc.get('reaction')} c{sc.get('clarity')}  {p.get('title')}")
        print(f"      why: {p.get('reason')}\n      hook: {p.get('hook')}   tags: {', '.join(p.get('tags', []))}")


if __name__ == "__main__":
    main()
