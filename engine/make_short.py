"""
Step 5 of the clip engine: cut one moment into a vertical short with burned-in captions.

  - Takes the words spoken inside the clip from the transcript.
  - Converts Hindi script to Roman Hinglish with a Groq chat call (word by word, so timing is kept).
  - Writes an ASS subtitle file: the opening line in a white box for the first seconds, then
    3 words on screen with the word being spoken highlighted in orange.
  - FFmpeg builds the "facecam on top, gameplay below" layout and burns everything in.

Usage:  python make_short.py <video> <start_sec> <length_sec> [--name clip] [--hook "text"]
Needs:  engine/.env with GROQ_API_KEY, and signals/<name>.transcript.json from transcribe.py
"""

import argparse
import json
import re
import subprocess
import time
from pathlib import Path

from llm import chat_json
from transcribe import load_key

# Facecam box as a share of the source frame (measured on a typical streamer overlay).
# Finding the facecam automatically comes later; for now the uploader picks the corner.
CAM_W, CAM_H, CAM_MARGIN = 0.197, 0.222, 0.008
LAYOUTS = ("top-right", "top-left", "bottom-right", "bottom-left", "none")
CAPTION_Y = 1300   # pixels from top of the 1080x1920 frame: upper part of the gameplay area
HOOK_Y = 600       # the opening line sits on the seam between facecam and gameplay
HOOK_SECONDS = 3.5


def even(x: float) -> int:
    return max(2, int(x) // 2 * 2)


def video_size(video: Path) -> tuple[int, int]:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(video)],
                       capture_output=True, text=True, check=True)
    w, h = r.stdout.strip().split(",")[:2]
    return int(w), int(h)


def output_size(height: int) -> tuple[int, int]:
    """Never upscale: a 720p recording becomes a 720x1280 short, 1080p and above become 1080x1920."""
    return (720, 1280) if height <= 720 else (1080, 1920)


_ENCODER: list[str] | None = None


def encoder_args() -> list[str]:
    """Intel Quick Sync if this machine has it (about 4x faster here), otherwise x264 on the CPU."""
    global _ENCODER
    if _ENCODER is None:
        test = subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.2", "-c:v", "h264_qsv", "-f", "null", "-"],
                              capture_output=True)
        _ENCODER = (["-c:v", "h264_qsv", "-global_quality", "23", "-preset", "veryfast"] if test.returncode == 0
                    else ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21"])
    return _ENCODER


def layout_filter(width: int, height: int, layout: str) -> str:
    """FFmpeg filter that turns a wide frame into a vertical frame named [v0]."""
    ow, oh = output_size(height)
    game_w = min(width, even(height * 9 / 16))
    if layout == "none":
        return f"[0:v]crop={game_w}:{height}:{(width - game_w) // 2}:0,scale={ow}:{oh}:flags=lanczos[v0]"
    cw, ch = even(width * CAM_W), even(height * CAM_H)
    mx, my = int(width * CAM_MARGIN), int(height * CAM_MARGIN)
    cx = width - cw - mx if layout.endswith("right") else mx
    cy = my if layout.startswith("top") else height - ch - my
    cam_h = even(ow * ch / cw)                   # keep the facecam's shape
    game_h = oh - cam_h
    split_w = min(width, even(height * ow / game_h))
    return (f"[0:v]split=2[a][b];[a]crop={cw}:{ch}:{cx}:{cy},scale={ow}:{cam_h}:flags=lanczos[cam];"
            f"[b]crop={split_w}:{height}:{(width - split_w) // 2}:0,scale={ow}:{game_h}:flags=lanczos[game];"
            f"[cam][game]vstack=inputs=2[v0]")
WORDS_PER_SCREEN = 3
DEVANAGARI = re.compile(r"[\u0900-\u097F]")


def to_roman(key: str, words: list[str]) -> list[str]:
    """Roman Hinglish for each word, same count and order. Words already in Latin letters are kept."""
    todo = [i for i, w in enumerate(words) if DEVANAGARI.search(w)]
    if not todo:
        return words
    prompt = (
        "Transliterate each Hindi word into casual Roman Hinglish, the way Indian gamers type in YouTube comments "
        "(e.g. \u092e\u0941\u091d\u0947 -> mujhe, \u0915\u094d\u092f\u093e -> kya, \u092f\u093e\u0930 -> yaar, \u0939\u0948 -> hai). "
        "Do not translate. Keep punctuation. "
        "Return only a JSON object {\"out\": [...]} with exactly one string per input word, same order.\n"
        + json.dumps([words[i] for i in todo], ensure_ascii=False)
    )
    for _ in range(2):
        out = chat_json(key, [{"role": "user", "content": prompt}], reasoning="low", temperature=0).get("out", [])
        if len(out) == len(todo):
            result = list(words)
            for i, w in zip(todo, out):
                result[i] = str(w)
            return result
    print("    Hinglish conversion returned the wrong number of words; keeping the original script.")
    return words


def roman_line(key: str, text: str) -> str:
    return " ".join(to_roman(key, text.split())) if DEVANAGARI.search(text) else text


def ass_time(t: float) -> str:
    t = max(0.0, t)
    h, m = int(t // 3600), int(t % 3600 // 60)
    return f"{h}:{m:02d}:{t % 60:05.2f}"


def clean(text: str) -> str:
    return text.replace("{", "").replace("}", "").replace("\\", "")


def build_ass(words: list[dict], path: Path, hook: str | None = None) -> None:
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Arial Black,88,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,3,8,60,60,{CAPTION_Y},1
Style: Hook,Arial Black,70,&H00000000,&H00000000,&H00FFFFFF,&H00FFFFFF,-1,0,0,0,100,100,0,0,3,18,0,8,90,90,{HOOK_Y},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []  # (start, end, text)
    for g in range(0, len(words), WORDS_PER_SCREEN):
        group = words[g: g + WORDS_PER_SCREEN]
        for k, w in enumerate(group):
            end = group[k + 1]["start"] if k + 1 < len(group) else (words[g + WORDS_PER_SCREEN]["start"] if g + WORDS_PER_SCREEN < len(words) else w["end"] + 0.3)
            end = min(end, w["end"] + 0.6)  # do not hold a word on screen through long silences
            parts = []
            for j, x in enumerate(group):
                text = clean(x["text"]).upper()
                # Orange (BGR in ASS) for the word being spoken, white for the others.
                parts.append(r"{\c&H4874FF&\fscx108\fscy108}" + text + r"{\r}" if j == k else text)
            events.append((w["start"], end, " ".join(parts)))
    # Speech-to-text word times can overlap slightly; two captions on screen at once get stacked
    # into two lines. Each caption ends exactly when the next one begins.
    events.sort(key=lambda e: e[0])
    lines = []
    for i, (s, e, text) in enumerate(events):
        if i + 1 < len(events):
            e = min(e, events[i + 1][0])
        if e - s < 0.05:
            continue
        lines.append(f"Dialogue: 0,{ass_time(s)},{ass_time(e)},Cap,,0,0,0,,{text}")
    if hook:
        lines.append(f"Dialogue: 1,{ass_time(0)},{ass_time(HOOK_SECONDS)},Hook,,0,0,0,,{clean(hook)}")
    path.write_text(head + "\n".join(lines) + "\n", encoding="utf-8")


def render_short(video: Path, start: float, length: float, out_dir: Path, name: str, key: str, transcript: dict,
                 hook: str | None = None, layout: str = "top-right") -> dict:
    """Make one finished short. Returns the caption words and timings."""
    out_dir.mkdir(parents=True, exist_ok=True)
    timings = {}
    words = [w for w in transcript["words"] if start <= w["start"] < start + length]

    t = time.perf_counter()
    roman = to_roman(key, [w["word"] for w in words]) if words else []
    hook = roman_line(key, hook) if hook else None
    timings["hinglish_s"] = round(time.perf_counter() - t, 1)
    clip_words = [{"text": r, "start": round(w["start"] - start, 2), "end": round(w["end"] - start, 2)} for w, r in zip(words, roman)]

    ass = out_dir / f"{name}.ass"
    build_ass(clip_words, ass, hook)

    t = time.perf_counter()
    # Run from the output folder so the subtitles filter gets a plain file name (Windows drive colons break it).
    vf = f"{layout_filter(*video_size(video), layout)};[v0]setsar=1,subtitles={ass.name}[v]"
    r = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-ss", str(start), "-i", str(video), "-t", str(length),
         "-filter_complex", vf, "-map", "[v]", "-map", "0:a",
         *encoder_args(), "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", f"{name}.mp4"],
        cwd=out_dir, capture_output=True, text=True,
    )
    if r.returncode:
        raise RuntimeError(f"FFmpeg failed for {name} (exit code {r.returncode}):\n{r.stderr[-1500:]}")
    timings["render_s"] = round(time.perf_counter() - t, 1)
    # Small poster image for lists and thumbnails, taken after the opening line has gone.
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(min(HOOK_SECONDS + 0.5, length / 2)), "-i", f"{name}.mp4", "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", f"{name}.jpg"],
                   cwd=out_dir, capture_output=True)
    return {"file": f"{name}.mp4", "poster": f"{name}.jpg", "hook": hook, "words": clip_words, "timings": timings}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=Path)
    ap.add_argument("start", type=float)
    ap.add_argument("length", type=float)
    ap.add_argument("--name", default="clip")
    ap.add_argument("--hook")
    ap.add_argument("--layout", choices=LAYOUTS, default="top-right")
    a = ap.parse_args()
    video = a.video.resolve()
    transcript = json.loads((video.parent / "signals" / f"{video.stem}.transcript.json").read_text(encoding="utf-8"))
    res = render_short(video, a.start, a.length, video.parent / "shorts", a.name, load_key(), transcript, a.hook, a.layout)
    print(f"{len(res['words'])} caption words. Timings: {res['timings']}")
    print("Hinglish:", " ".join(w["text"] for w in res["words"]))


if __name__ == "__main__":
    main()
