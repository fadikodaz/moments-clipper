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
LAYOUTS = ("auto", "top-right", "top-left", "bottom-right", "bottom-left", "none", "full")
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


def layout_filter(width: int, height: int, layout: str, box: dict | None = None) -> tuple[str, int]:
    """FFmpeg filter that turns a wide frame into a vertical frame named [v0], plus the facecam height
    in the output (0 when there is none), so covers can be cut from the gameplay part only.

    layout: "auto" (use the detected box, gameplay only if none was found), a corner name, "none"
    (gameplay only, cropped from the middle) or "full" (the whole frame, blurred copy filling the edges).
    box: detected facecam as fractions of the frame (facecam.py); without it a default corner box is used.
    """
    ow, oh = output_size(height)
    if layout == "full":
        return (f"[0:v]split=2[a][b];[a]scale={ow}:{oh}:force_original_aspect_ratio=increase,crop={ow}:{oh},"
                f"scale={ow // 8}:{oh // 8},boxblur=6:2,scale={ow}:{oh},eq=brightness=-0.05[bg];"
                f"[b]scale={ow}:-2:flags=lanczos[fg];[bg][fg]overlay=0:(H-h)/2[v0]"), 0
    game_w = min(width, even(height * 9 / 16))
    if layout == "none" or (layout == "auto" and not box):
        return f"[0:v]crop={game_w}:{height}:{(width - game_w) // 2}:0,scale={ow}:{oh}:flags=lanczos[v0]", 0
    if box:
        cw, ch = even(width * box["w"]), even(height * box["h"])
        cx = min(width - cw, max(0, int(width * box["x"])))
        cy = min(height - ch, max(0, int(height * box["y"])))
    else:
        cw, ch = even(width * CAM_W), even(height * CAM_H)
        mx, my = int(width * CAM_MARGIN), int(height * CAM_MARGIN)
        cx = width - cw - mx if layout.endswith("right") else mx
        cy = my if layout.startswith("top") else height - ch - my
    cam_h = even(ow * ch / cw)                   # keep the facecam's shape
    game_h = oh - cam_h
    split_w = min(width, even(height * ow / game_h))
    return (f"[0:v]split=2[a][b];[a]crop={cw}:{ch}:{cx}:{cy},scale={ow}:{cam_h}:flags=lanczos[cam];"
            f"[b]crop={split_w}:{height}:{(width - split_w) // 2}:0,scale={ow}:{game_h}:flags=lanczos[game];"
            f"[cam][game]vstack=inputs=2[v0]"), cam_h
WORDS_PER_SCREEN = 4
DEVANAGARI = re.compile(r"[\u0900-\u097F]")


def _ask_words(key: str, words: list[str], instruction: str) -> list[str] | None:
    prompt = (instruction + "\nReturn only a JSON object {\"out\": [...]} with exactly one string per input word, same order, "
              "same count (" + str(len(words)) + ").\n" + json.dumps(words, ensure_ascii=False))
    for _ in range(2):
        out = chat_json(key, [{"role": "user", "content": prompt}], reasoning="low", temperature=0).get("out", [])
        if len(out) == len(words):
            return [str(w) for w in out]
    return None


CLEAN = (
    "These are the words of a short clip from a Hindi/Hinglish gaming stream, as heard by speech-to-text. "
    "For each word give casual Roman Hinglish, the way Indian gamers type in YouTube comments "
    "(e.g. \u092e\u0941\u091d\u0947 -> mujhe, \u0915\u094d\u092f\u093e -> kya, \u092f\u093e\u0930 -> yaar, \u0939\u0948 -> hai). "
    "Speech-to-text often mishears words; using the whole sentence as context, replace a word with the word the "
    "speaker most likely said when the original makes no sense (e.g. 'gais' -> 'guys', 'aul right' -> 'all right'). "
    "Do not translate, summarise, add or remove words. If a word is unclear and you can't tell, keep it as it sounds."
)


def to_roman(key: str, words: list[str]) -> list[str]:
    """Roman Hinglish for each word with obvious mishearings fixed; same count and order, so word timing is kept."""
    if not words:
        return words
    result: list[str] = []
    # Long clips are sent in chunks of whole sentences' worth of words, so the model keeps the count right.
    for i in range(0, len(words), 120):
        chunk = words[i: i + 120]
        fixed = _ask_words(key, chunk, CLEAN)
        if fixed is None:  # fall back to plain transliteration of Hindi script only
            todo = [k for k, w in enumerate(chunk) if DEVANAGARI.search(w)]
            plain = _ask_words(key, [chunk[k] for k in todo], "Transliterate each Hindi word into casual Roman Hinglish. Do not translate.") if todo else []
            fixed = list(chunk)
            if plain:
                for k, w in zip(todo, plain):
                    fixed[k] = w
            else:
                print("    Hinglish conversion failed for part of a clip; keeping the original script.")
        result.extend(fixed)
    return result

def roman_line(key: str, text: str) -> str:
    return " ".join(to_roman(key, text.split())) if DEVANAGARI.search(text) else text


def split_tokens(words: list[dict]) -> list[dict]:
    """One entry per space-separated word, so the website can line up edits word by word.
    A converted word that became two ("all right") shares its time span evenly."""
    out = []
    for w in words:
        parts = w["text"].split()
        if len(parts) <= 1:
            out.append({**w, "text": w["text"].strip()} if parts else None)
            continue
        step = (w["end"] - w["start"]) / len(parts)
        out += [{"text": p, "start": round(w["start"] + i * step, 2), "end": round(w["start"] + (i + 1) * step, 2)} for i, p in enumerate(parts)]
    return [w for w in out if w]


def clip_caption_words(key: str, transcript: dict, start: float, length: float) -> list[dict]:
    """Words spoken between start and start+length, in Roman Hinglish, times relative to start."""
    words = [w for w in transcript["words"] if start <= w["start"] < start + length]
    roman = to_roman(key, [w["word"] for w in words]) if words else []
    return split_tokens([{"text": r, "start": round(w["start"] - start, 2), "end": round(w["end"] - start, 2)} for w, r in zip(words, roman)])


def ass_time(t: float) -> str:
    t = max(0.0, t)
    h, m = int(t // 3600), int(t % 3600 // 60)
    return f"{h}:{m:02d}:{t % 60:05.2f}"


def clean(text: str) -> str:
    return text.replace("{", "").replace("}", "").replace("\\", "")


def build_ass(words: list[dict], path: Path, hook: str | None = None, captions: str = "bold", hook_y: int = HOOK_Y) -> None:
    """captions: "bold" (big, word by word, spoken word in orange), "simple" (plain phrase in a box) or "none"."""
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Arial Black,76,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,3,8,60,60,{CAPTION_Y},1
Style: Simple,Arial,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H99000000,-1,0,0,0,100,100,0,0,3,14,0,8,80,80,{CAPTION_Y},1
Style: Hook,Arial Black,70,&H00000000,&H00000000,&H00FFFFFF,&H00FFFFFF,-1,0,0,0,100,100,0,0,3,18,0,8,90,90,{hook_y},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []  # (start, end, text)
    if captions == "none":
        words = []
    if captions == "simple":
        for g in range(0, len(words), WORDS_PER_SCREEN + 2):
            group = words[g: g + WORDS_PER_SCREEN + 2]
            nxt = words[g + WORDS_PER_SCREEN + 2]["start"] if g + WORDS_PER_SCREEN + 2 < len(words) else group[-1]["end"] + 0.4
            events.append((group[0]["start"], min(nxt, group[-1]["end"] + 0.8), clean(" ".join(x["text"] for x in group))))
        words = []
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
        lines.append(f"Dialogue: 0,{ass_time(s)},{ass_time(e)},{'Simple' if captions == 'simple' else 'Cap'},,0,0,0,,{text}")
    if hook:
        lines.append(f"Dialogue: 1,{ass_time(0)},{ass_time(HOOK_SECONDS)},Hook,,0,0,0,,{clean(hook)}")
    path.write_text(head + "\n".join(lines) + "\n", encoding="utf-8")


def render_short(video: Path | None, start: float, length: float, out_dir: Path, name: str, key: str, transcript: dict,
                 hook: str | None = None, layout: str = "top-right", remote: dict | None = None, box: dict | None = None,
                 captions: str = "bold", words_override: list[dict] | None = None) -> dict:
    """Make one finished short. Returns the caption words and timings.

    remote: direct stream addresses from fetch.remote_source(); FFmpeg then reads only this
    short's seconds from the server instead of a local file.
    words_override: caption words already prepared (edited by the user), times relative to start;
    the hook is then used exactly as given.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    timings = {}
    t = time.perf_counter()
    if words_override is not None:
        clip_words = words_override
    else:
        clip_words = clip_caption_words(key, transcript, start, length)
        hook = roman_line(key, hook) if hook else None
    timings["hinglish_s"] = round(time.perf_counter() - t, 1)

    ass = out_dir / f"{name}.ass"
    # With the whole frame shown, the opening line goes above the picture instead of over it.
    build_ass(clip_words, ass, hook, captions, 430 if layout == "full" else HOOK_Y)

    t = time.perf_counter()
    # Run from the output folder so the subtitles filter gets a plain file name (Windows drive colons break it).
    if remote:
        net = ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5", "-headers", remote["headers"]]
        inputs = ["-ss", str(start), *net, "-i", remote["video"]]
        audio = "0:a"
        if remote.get("audio"):
            inputs += ["-ss", str(start), *net, "-i", remote["audio"]]
            audio = "1:a"
        size = (remote["width"], remote["height"])
    else:
        assert video is not None
        inputs, audio, size = ["-ss", str(start), "-i", str(video)], "0:a", video_size(video)
    lf, cam_h = layout_filter(*size, layout, box)
    # One pass, two outputs: the short with captions, and a clean cover frame of the gameplay part
    # (taken after the opening line, before captions are burned in).
    at = round(min(HOOK_SECONDS + 1.5, length * 0.5), 2)
    vf = (f"{lf};[v0]setsar=1,split=2[m][p];[m]subtitles={ass.name}[v];"
          f"[p]select='gte(t\\,{at})',crop=iw:ih-{cam_h}:0:{cam_h},scale=480:-2[pv]")
    r = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", vf,
         "-t", str(length), "-map", "[v]", "-map", audio,
         *encoder_args(), "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", f"{name}.mp4",
         "-map", "[pv]", "-frames:v", "1", "-update", "1", "-q:v", "3", f"{name}.jpg"],
        cwd=out_dir, capture_output=True, text=True,
    )
    if r.returncode:
        raise RuntimeError(f"FFmpeg failed for {name} (exit code {r.returncode}):\n{r.stderr[-1500:]}")
    timings["render_s"] = round(time.perf_counter() - t, 1)
    if not (out_dir / f"{name}.jpg").exists():  # fallback cover from the finished short
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(at), "-i", f"{name}.mp4", "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", f"{name}.jpg"],
                       cwd=out_dir, capture_output=True)
    return {"file": f"{name}.mp4", "poster": f"{name}.jpg", "hook": hook, "words": clip_words, "timings": timings}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=Path)
    ap.add_argument("start", type=float)
    ap.add_argument("length", type=float)
    ap.add_argument("--name", default="clip")
    ap.add_argument("--hook")
    ap.add_argument("--layout", choices=LAYOUTS, default="auto")
    a = ap.parse_args()
    video = a.video.resolve()
    transcript = json.loads((video.parent / "signals" / f"{video.stem}.transcript.json").read_text(encoding="utf-8"))
    res = render_short(video, a.start, a.length, video.parent / "shorts", a.name, load_key(), transcript, a.hook, a.layout)
    print(f"{len(res['words'])} caption words. Timings: {res['timings']}")
    print("Hinglish:", " ".join(w["text"] for w in res["words"]))


if __name__ == "__main__":
    main()
