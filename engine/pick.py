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

from llm import CLAUDE_MODEL, MODEL, smart_json, using_claude
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
You read a part of a transcript from {speaker}. Lines look like "[612-615] text"
(seconds into the video). LOUD marks a big volume spike (action, explosion, shouting, laughter).

Propose up to {per_part} moments from this part that would each make a great standalone short.
Good moments: a fail or win with a strong reaction, a funny exchange, a chase or fight with a payoff,
a surprising twist, a story with a punchline. Skip greetings, intros/outros, sponsor or subscribe talk,
menu/loading talk, and slow explaining with no payoff. Fewer strong moments beat more weak ones;
return an empty list if nothing is good.
{brief}
For each moment:
- start/end: seconds taken from line timestamps. Length {lo}-{hi} seconds.
  Viewers decide in the first 2 seconds whether to keep watching: start 1-3 seconds before the first
  thing that grabs attention (a shout, a reveal, a funny line, a crash). Never start on slow setup,
  greetings, menus or explaining; never mid-sentence. If the moment needs context, keep it short.
  End right after the payoff and the reaction to it, not in the middle of a sentence.
- peak: the second (from the line timestamps) of the single biggest moment in it: the loudest
  reaction or the punchline. It is shown first as a teaser, so it must make people want the rest.
- title: {title_rule} No clickbait words like "insane" or "you won't believe".
- reason: one English sentence: why this works as a short, concrete.
- hook: opening line for the top of the short, max 8 words, {hook_style}. Tease the payoff without
  giving it away ("Wait for the reaction..."), so viewers stay to see it.
- tags: 1-3 from: Police chase, Shootout, Heist, Crash, Stunt, Race, Funny, Fail, Win, Reaction, Story, Tension.
- scores 0-100: hook (first 3 s grab), action (what happens on screen), reaction (streamer's energy/humour),
  clarity (understandable alone). overall = your honest judgement, not an average. Be strict: most moments 55-80.
Return only JSON: {{"moments":[{{"start":..,"end":..,"peak":..,"title":"..","reason":"..","hook":"..","tags":[..],"scores":{{"hook":..,"action":..,"reaction":..,"clarity":..}},"overall":..}}]}}"""


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


def campaign_brief(campaign: dict | None) -> str:
    """Extra instructions from a clipping campaign: who must be the focus, what to look for and what to avoid."""
    if not campaign:
        return ""
    who, mention = campaign.get("streamer", "").strip(), campaign.get("mention", "").strip()
    lines = ["", "This is for a paid clipping campaign; clips that break its rules earn nothing."]
    if who:
        lines.append(f"- The streamer is {who}. Every clip must have {who} as the main focus (their own words, actions and reactions).")
        lines.append(f"- Never pick moments that show {who} in a negative light, drama, arguments made to look bad, or anything hateful.")
    if mention:
        lines.append(f"- Every hook must contain the name \"{mention}\".")
    for label, key in (("Look for", "lookFor"), ("Avoid", "avoid")):
        if campaign.get(key, "").strip():
            lines.append(f"- {label}: {campaign[key].strip()}")
    return "\n".join(lines) + "\n"


def pick(video: Path, key: str, transcript: dict, loud: np.ndarray, top: int = 10, n_candidates: int = 0, on_batch=None,
         length: str = "auto", count: int | None = None, on_found=None, language: str = "hi", campaign: dict | None = None,
         lengths: tuple[float, float] | None = None) -> dict:
    """length: auto/short/long (see LENGTHS). count: exact number of shorts, or None for about one per 5 minutes.
    language: "hi" (Hinglish stream, Hinglish hooks) or "en". campaign: rules from a clipping campaign (campaign_brief).
    on_found(moments): called after each part with every moment accepted so far, for the live timeline."""
    sig = video.parent / "signals"
    lo_len, hi_len = lengths or LENGTHS.get(length, LENGTHS["auto"])
    # Claude reads longer parts at once (better sense of what stands out); Groq's free tier needs small ones.
    part_len = 15 * 60 if using_claude() else PART
    per_part = (PER_PART + (2 if part_len > PART else 0)) if not count else max(PER_PART, min(8, -(-count * 2 // max(1, round(len(loud) / (part_len - OVERLAP))))))
    speaker = "a Hindi/Hinglish gaming streamer" if language == "hi" else "an English-speaking gaming streamer"
    if campaign and campaign.get("streamer"):
        speaker += f" ({campaign['streamer']})"
    hook_style = "casual Roman Hinglish (English letters only)" if language == "hi" else "casual English, the way viewers talk in comments"
    mention = ((campaign or {}).get("mention") or "").strip()
    keywords = ", ".join((campaign or {}).get("keywords") or [])
    title_rule = "short English title (max 7 words) saying what happens."
    if mention:
        title_rule = (f"English title for YouTube, max 10 words, saying what happens. Write the full name \"{mention}\" exactly once "
                      f"(never repeat it or add a shortened name next to it)"
                      + (f", and include one of these search words when it fits naturally: {keywords}." if keywords else "."))
    system = SYSTEM_TEMPLATE.format(lo=int(lo_len), hi=int(hi_len), per_part=per_part, speaker=speaker, brief=campaign_brief(campaign),
                                    hook_style=hook_style, title_rule=title_rule)
    loud_z = score_seconds(loud, [])["loud_z"]
    total = float(len(loud))
    t0 = time.perf_counter()

    lo_edge, hi_edge = (SKIP_EDGES, total - SKIP_EDGES) if total > SKIP_EDGES * 4 else (0.0, total)
    starts = list(np.arange(lo_edge, max(lo_edge + 1, hi_edge - OVERLAP), part_len - OVERLAP))
    print(f"  reading {len(starts)} parts of about {part_len // 60} min with {CLAUDE_MODEL if using_claude() else MODEL}")

    proposals = []
    for n, lo in enumerate(starts, 1):
        hi = min(hi_edge, lo + part_len)
        text = part_text(lo, hi, transcript["segments"], loud_z)
        if len(text) > 80:
            res = smart_json(key, [{"role": "system", "content": system},
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
            # The teaser second must lie inside the final clip; otherwise use the middle.
            try:
                pk = float(x.get("peak"))
            except (TypeError, ValueError):
                pk = (s + e) / 2
            picks.append({**x, "start": s, "end": e, "peak": pk if s + 1 <= pk <= e - 1 else (s + e) / 2})
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

    out = {"video": str(video), "model": CLAUDE_MODEL if using_claude() else MODEL, "parts": len(starts), "proposed": len(proposals), "kept_by_ai": len(picks),
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
