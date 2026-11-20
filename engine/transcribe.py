"""
Step 2 of the clip engine: speech to text with a timestamp for every word, using Groq's Whisper.

The audio is sent in 10-minute pieces (small compressed files), and word times from each
piece are shifted back to their place in the full video.

Usage:  python transcribe.py <video> [--model whisper-large-v3]
Needs:  GROQ_API_KEY in engine/.env
Writes: <video folder>/signals/<name>.transcript.json
"""

import argparse
import json
import re
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

API_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
CHUNK_SEC = 600
PARALLEL = 4  # pieces sent at the same time
# Telling Whisper the language and the kind of talk cuts mishearings a lot for Hinglish gaming streams.
LANGUAGE = "hi"
PROMPTS = {
    "hi": "Hindi gaming stream with English words: bhai, guys, yaar, GTA, car, bike, police, race, jump, game, stream, chat, subscribe, okay, come on, let's go.",
    # Kept short and unlike real speech: Whisper sometimes writes its prompt into the transcript.
    "en": "GTA livestream with chat.",
}
PROMPT = PROMPTS["hi"]


def prompt_for(language: str, names: str = "") -> str:
    """Whisper prompt for the stream's language; names (like the streamer's) help it spell them right."""
    return (f"{names}. " if names else "") + PROMPTS.get(language, PROMPTS["en"])


def load_key() -> str:
    env = Path(__file__).with_name(".env")
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("GROQ_API_KEY="):
                os.environ.setdefault("GROQ_API_KEY", line.split("=", 1)[1].strip().strip('"'))
    key = os.environ.get("GROQ_API_KEY", "")
    if not key:
        sys.exit("No GROQ_API_KEY found. Put it in engine/.env (see .env.example).")
    return key


def duration(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture_output=True, text=True)
    return float(r.stdout.strip())


def make_chunk(video: Path, start: int, out: Path) -> None:
    # 16 kHz mono at 32 kbps: about 2.4 MB per 10 minutes, well under the upload limit.
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-ss", str(start), "-t", str(CHUNK_SEC), "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", str(out)],
        check=True,
    )


def transcribe_chunk(key: str, path: Path, model: str, language: str = LANGUAGE, prompt: str = PROMPT) -> dict:
    for attempt in range(4):
        with path.open("rb") as f:
            r = requests.post(
                API_URL,
                headers={"Authorization": f"Bearer {key}"},
                files={"file": (path.name, f, "audio/mpeg")},
                data=[("model", model), ("language", language), ("prompt", prompt), ("response_format", "verbose_json"), ("timestamp_granularities[]", "word"), ("timestamp_granularities[]", "segment")],
                timeout=300,
            )
        if r.status_code == 429:  # rate limit on the free tier: wait and retry
            wait = float(r.headers.get("retry-after", 20))
            print(f"  rate limited, waiting {wait:.0f} s")
            time.sleep(wait)
            continue
        if r.status_code != 200:
            sys.exit(f"Groq error {r.status_code}: {r.text[:500]}")
        return r.json()
    sys.exit("Gave up after repeated rate limits.")


def _norm(t: str) -> str:
    return re.sub(r"[^a-z0-9']+", " ", t.lower()).strip()


def strip_prompt_echo(res: dict, prompt: str) -> dict:
    """Whisper now and then 'hears' its own prompt at the start of a piece. Remove any run of
    3 or more words that copies the prompt word for word, from the words and from the lines."""
    pw = _norm(prompt).split()

    def echo(tokens: list[str]) -> int:
        best = 0
        for i in range(len(pw)):
            k = 0
            while k < len(tokens) and i + k < len(pw) and tokens[k] == pw[i + k]:
                k += 1
            best = max(best, k)
        return best

    words = res.get("words", [])
    toks = [_norm(w["word"]) for w in words]
    # Only the opening of a piece: real speech can contain prompt phrases ("come on, let's go") later on.
    first = res.get("segments") or [{"end": 10.0}]
    limit = sum(1 for w in words if w["start"] <= first[0]["end"])
    keep, i = [True] * len(words), 0
    while i < limit:
        k = echo(toks[i: i + 40])
        if k >= 3:
            keep[i: i + k] = [False] * k
            i += k
        else:
            i += 1
    segs = []
    for n, s in enumerate(res.get("segments", [])):
        parts = s["text"].split()
        # In the first line, drop leading words copied from the prompt (as many as their run).
        k = 0
        while n == 0 and k < len(parts) and echo([_norm(x) for x in parts[: k + 1]]) == k + 1:
            k += 1
        if k >= 3:
            parts = parts[k:]
        if parts:
            segs.append({**s, "text": " ".join(parts)})
    dropped = keep.count(False)
    if dropped:
        print(f"  removed {dropped} words Whisper copied from its prompt", flush=True)
    return {**res, "words": [w for w, ok in zip(words, keep) if ok], "segments": segs}


def transcribe(video: Path, key: str, model: str = "whisper-large-v3", on_piece=None, language: str = LANGUAGE, prompt: str | None = None) -> dict:
    out_dir = video.parent / "signals"
    tmp = out_dir / "chunks"
    tmp.mkdir(parents=True, exist_ok=True)

    total = duration(video)
    words, segments, languages = [], [], []
    t0 = time.perf_counter()
    # Skip a last piece under 2 seconds (e.g. a part of exactly 30:00): it is empty and Whisper rejects it.
    starts = [s for s in range(0, int(total) + 1, CHUNK_SEC) if total - s >= 2]
    done = 0
    lock = threading.Lock()

    def one(i: int, start: int) -> dict:
        nonlocal done
        part = tmp / f"chunk_{i:03d}.mp3"
        make_chunk(video, start, part)
        t = time.perf_counter()
        p = prompt or prompt_for(language)
        res = strip_prompt_echo(transcribe_chunk(key, part, model, language, p), p)
        print(f"  piece {i + 1}: {start // 60}-{min(total, start + CHUNK_SEC) // 60:.0f} min, {len(res.get('words', []))} words, {time.perf_counter() - t:.1f} s", flush=True)
        with lock:
            done += 1
            if on_piece:
                on_piece(done, len(starts))
        return res

    # Pieces are independent, so they go out together; results are put back in time order below.
    with ThreadPoolExecutor(max_workers=PARALLEL) as pool:
        results = list(pool.map(one, range(len(starts)), starts))
    for start, res in zip(starts, results):
        languages.append(res.get("language"))
        for w in res.get("words", []):
            words.append({"word": w["word"].strip(), "start": round(w["start"] + start, 2), "end": round(w["end"] + start, 2)})
        for s in res.get("segments", []):
            segments.append({"start": round(s["start"] + start, 2), "end": round(s["end"] + start, 2), "text": s["text"].strip()})

    result = {"video": str(video), "model": model, "languages": sorted({l for l in languages if l}), "seconds_taken": round(time.perf_counter() - t0, 1), "words": words, "segments": segments}
    out = out_dir / f"{video.stem}.transcript.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  {len(words)} words, {len(segments)} lines, language {result['languages']}")
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=Path)
    ap.add_argument("--model", default="whisper-large-v3")
    a = ap.parse_args()
    transcribe(a.video.resolve(), load_key(), a.model)


if __name__ == "__main__":
    main()
