"""
Step 5 of the clip engine: cut one moment into a vertical short with burned-in captions.

  - Takes the words spoken inside the clip from the transcript (Roman Hinglish for Hindi streams).
  - Writes an ASS subtitle file: the opening line for the first seconds, then the captions in the
    chosen look (word by word with the spoken word highlighted, or simple lines).
  - FFmpeg builds the chosen layout (style.py), optionally starts with 1.5 s of the biggest moment,
    zooms in on the facecam at loud moments, draws a progress bar and burns everything in.

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
from style import FONTS, ass_color, censor, normalize
from transcribe import load_key

# Facecam box used when none was detected or drawn (a typical top-right streamer overlay).
CAM_W, CAM_H, CAM_MARGIN = 0.197, 0.222, 0.008
LAYOUTS = ("auto", "top-right", "top-left", "bottom-right", "bottom-left", "none", "full")
HOOK_SECONDS = 3.5
FLASH = 1.5        # seconds of the biggest moment shown first
FPS = 30
FONT_DIR = Path(__file__).with_name("fonts")


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


def cam_pixels(width: int, height: int, box: dict | None, corner: str = "top-right") -> tuple[int, int, int, int]:
    """Facecam rectangle in source pixels: the given box, or a default box in a corner."""
    if box:
        cw, ch = even(width * box["w"]), even(height * box["h"])
        cx = min(width - cw, max(0, int(width * box["x"])))
        cy = min(height - ch, max(0, int(height * box["y"])))
        return cx, cy, cw, ch
    cw, ch = even(width * CAM_W), even(height * CAM_H)
    mx, my = int(width * CAM_MARGIN), int(height * CAM_MARGIN)
    corner = corner if corner in LAYOUTS[1:5] else "top-right"
    return (width - cw - mx if corner.endswith("right") else mx), (my if corner.startswith("top") else height - ch - my), cw, ch


def fit(cx: int, cy: int, cw: int, ch: int, aspect: float) -> tuple[int, int, int, int]:
    """Largest part of a rectangle with the given width/height ratio, centred."""
    if cw / ch > aspect:
        nw = even(ch * aspect)
        return cx + (cw - nw) // 2, cy, nw, ch
    nh = even(cw / aspect)
    return cx, cy + (ch - nh) // 2, cw, nh


def game_crop(width: int, height: int, aspect: float, focus: float) -> str:
    w = min(width, even(height * aspect))
    h = height if w < width else min(height, even(width / aspect))
    return f"crop={w}:{h}:{int(focus * (width - w))}:{(height - h) // 2}"


def zoom_filter(windows: list[tuple[float, float]], w: int, h: int) -> str:
    """Quick 15% push-in during each window (seconds in the short), eased over 0.2 s."""
    if not windows:
        return ""
    bumps = [f"clip((in_time-{a:.2f})/0.2,0,1)*clip(({b:.2f}-in_time)/0.2,0,1)" for a, b in windows]
    z = bumps[0]
    for b in bumps[1:]:
        z = f"max({z},{b})"
    return f",zoompan=z='1+0.15*{z}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={w}x{h}:fps={FPS}"


def layout_filter(width: int, height: int, style: dict, box: dict | None, src: str = "[0:v]", corner: str = "top-right",
                  zooms: list[tuple[float, float]] | None = None) -> tuple[str, dict]:
    """FFmpeg filter turning a wide frame ({src}) into the vertical frame [v0], plus where things are:
    {"cover": (y, h) of the gameplay part for the cover image, "hook_y": opening-line height (1920 units)}."""
    ow, oh = output_size(height)
    z = zooms or []
    k = 1920 / oh
    lay = style["layout"]
    if lay in ("top", "bottom", "pip") and style.get("nocam"):
        lay = "game"
    cam = cam_pixels(width, height, style.get("cam") or box, corner) if lay in ("top", "bottom", "pip") else None
    head = f"{src}fps={FPS},setsar=1"
    if lay in ("top", "bottom"):
        cam_h = even(oh * style["camPct"] / 100)
        gap_h = even(oh * style.get("gap", 0) / 100) if style.get("gap", 0) >= 1 else 0
        game_h = oh - cam_h - gap_h
        cx, cy, cw, ch = fit(*cam, ow / cam_h)
        n = 3 if gap_h and style.get("gapStyle") == "blur" else 2
        f = (f"{head},split={n}[a][b]{'[c]' if n == 3 else ''};[a]crop={cw}:{ch}:{cx}:{cy},scale={ow}:{cam_h}:flags=lanczos{zoom_filter(z, ow, cam_h)}[cam];"
             f"[b]{game_crop(width, height, ow / game_h, style['focus'])},scale={ow}:{game_h}:flags=lanczos[game];")
        if gap_h:
            # The space between facecam and gameplay: a calm band where the opening line sits.
            if n == 3:
                f += f"[c]scale={ow // 4}:{max(8, even(gap_h / 4))},gblur=sigma=6,scale={ow}:{gap_h},eq=brightness=-0.3[gp];"
            else:
                col = "black" if style.get("gapStyle") != "color" else "0x" + style.get("gapColor", "#ff7448")[1:]
                f += f"color=c={col}:s={ow}x{gap_h}:r={FPS}[gp];"
            order = "[cam][gp][game]" if lay == "top" else "[game][gp][cam]"
            f += f"{order}vstack=inputs=3:shortest=1[v0]"
        else:
            f += "[cam][game]vstack=inputs=2[v0]" if lay == "top" else "[game][cam]vstack=inputs=2[v0]"
        seam = cam_h + gap_h / 2 if lay == "top" else game_h + gap_h / 2
        return f, {"cover": (cam_h + gap_h, game_h) if lay == "top" else (0, game_h), "gap_y": int(seam * k)}
    if lay == "pip":
        cx, cy, cw, ch = cam
        pw = even(ow * style["pipSize"] / 100)
        ph = even(pw * ch / cw)
        m, top, bottom = even(ow * 0.04), even(oh * 0.09), even(oh * 0.22)
        x = m if style["pipCorner"][1] == "l" else ow - pw - 12 - m
        y = top if style["pipCorner"][0] == "t" else oh - ph - 12 - bottom
        f = (f"{head},split=2[a][b];[b]{game_crop(width, height, ow / oh, style['focus'])},scale={ow}:{oh}:flags=lanczos[g];"
             f"[a]crop={cw}:{ch}:{cx}:{cy},scale={pw}:{ph}:flags=lanczos{zoom_filter(z, pw, ph)},pad={pw + 12}:{ph + 12}:6:6:white[c];"
             f"[g][c]overlay={x}:{y}[v0]")
        return f, {"cover": (0, oh), "gap_y": int((y + ph + 70) * k) if style["pipCorner"][0] == "t" else 300}
    if lay == "full":
        f = (f"{head},split=2[a][b];[a]scale={ow}:{oh}:force_original_aspect_ratio=increase,crop={ow}:{oh},"
             f"scale={ow // 8}:{oh // 8},boxblur=6:2,scale={ow}:{oh},eq=brightness=-0.05[bg];"
             f"[b]scale={ow}:-2:flags=lanczos[fg];[bg][fg]overlay=0:(H-h)/2[v0]")
        return f, {"cover": (0, oh), "gap_y": 470}
    f = f"{head},{game_crop(width, height, ow / oh, style['focus'])},scale={ow}:{oh}:flags=lanczos{zoom_filter(z, ow, oh)}[v0]"
    return f, {"cover": (0, oh), "gap_y": 300}


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


def clip_caption_words(key: str, transcript: dict, start: float, length: float, language: str = "hi") -> list[dict]:
    """Words spoken between start and start+length, times relative to start.
    Hindi streams are turned into Roman Hinglish; English is used as heard."""
    words = [w for w in transcript["words"] if start <= w["start"] < start + length]
    roman = (to_roman(key, [w["word"] for w in words]) if language == "hi" else [w["word"] for w in words]) if words else []
    return split_tokens([{"text": r, "start": round(w["start"] - start, 2), "end": round(w["end"] - start, 2)} for w, r in zip(words, roman)])


def ass_time(t: float) -> str:
    t = max(0.0, t)
    h, m = int(t // 3600), int(t % 3600 // 60)
    return f"{h}:{m:02d}:{t % 60:05.2f}"


def clean(text: str) -> str:
    return text.replace("{", "").replace("}", "").replace("\\", "")


def build_ass(words: list[dict], path: Path, hook: str | None, style: dict, gap_y: int = 600, total: float | None = None) -> None:
    """Captions and opening line in the chosen look. Positions are in a 1080x1920 canvas."""
    c, h = style["captions"], style["hook"]
    font = FONTS[c["font"]]
    size = round(c["size"] * 3)
    cap_y = round(1920 * c["y"] / 100)
    outline = 7 if c["outline"] else 0
    white, hl = ass_color(c["color"]), ass_color(c["hl"])
    # Opening line: a box (colour + see-through) or, without a box, outlined text.
    boxed = h["bg"] is not None
    hook_back = ass_color(h["bg"], round(h["op"] / 100 * 255)) if boxed else "&H00000000"
    hook_text = ass_color(h["fg"])
    hook_border = 3 if boxed else 1
    hook_font = FONTS[h["font"]]
    hook_size = round(h["size"] * 3.75)
    hook_y = {"gap": gap_y, "top": 175}.get(h["pos"], round(1920 * h["y"] / 100))
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{font},{size},{white},{white},&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,{outline},{3 if outline else 2},8,60,60,{cap_y},1
Style: Simple,{font},{round(size * 0.72)},{white},{white},&H00000000,&H99000000,0,0,0,0,100,100,0,0,3,14,0,8,80,80,{cap_y},1
Style: Hook,{hook_font},{hook_size},{hook_text},{hook_text},{hook_back},{hook_back},0,0,0,0,100,100,0,0,{hook_border},{18 if boxed else 6},0,5,90,90,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    def say(t: str) -> str:
        t = clean(t)
        t = censor(t) if c["censor"] else t
        return t.upper() if c["upper"] else t

    per = c["words"]
    events = []  # (start, end, text)
    if c["style"] == "box":
        per = max(per, 4)
        for g in range(0, len(words), per):
            group = words[g: g + per]
            nxt = words[g + per]["start"] if g + per < len(words) else group[-1]["end"] + 0.4
            events.append((group[0]["start"], min(nxt, group[-1]["end"] + 0.8), say(" ".join(x["text"] for x in group))))
    elif c["style"] == "word":
        for g in range(0, len(words), per):
            group = words[g: g + per]
            for k, w in enumerate(group):
                end = group[k + 1]["start"] if k + 1 < len(group) else (words[g + per]["start"] if g + per < len(words) else w["end"] + 0.3)
                end = min(end, w["end"] + 0.6)  # do not hold a word on screen through long silences
                parts = [r"{\c" + hl + r"&\fscx108\fscy108}" + say(x["text"]) + r"{\r}" if j == k else say(x["text"]) for j, x in enumerate(group)]
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
        lines.append(f"Dialogue: 0,{ass_time(s)},{ass_time(e)},{'Simple' if c['style'] == 'box' else 'Cap'},,0,0,0,,{text}")
    if hook and h["on"]:
        end = total if h["show"] == "all" and total else h["sec"]
        # Centred on its spot (an5 + pos), so a two-line opening line stays in the middle of the gap.
        lines.append(f"Dialogue: 1,{ass_time(0)},{ass_time(end)},Hook,,0,0,0,,{{\\an5\\pos(540,{hook_y})}}{clean(hook)}")
    path.write_text(head + "\n".join(lines) + "\n", encoding="utf-8")


def render_short(video: Path | None, start: float, length: float, out_dir: Path, name: str, key: str, transcript: dict,
                 hook: str | None = None, layout: str = "top-right", remote: dict | None = None, box: dict | None = None,
                 captions: str = "bold", words_override: list[dict] | None = None, language: str = "hi",
                 style: dict | None = None, peak: float | None = None, zooms: list[tuple[float, float]] | None = None,
                 base: float = 0.0) -> dict:
    """Make one finished short. Returns the caption words (times from the moment's start) and timings.

    remote: direct stream addresses from fetch.remote_source(); FFmpeg then reads only this
    short's seconds from the server instead of a local file.
    words_override: caption words already prepared (edited by the user); the hook is then used as given.
    style: the look (style.py); without it the old layout/captions options are used.
    peak: second (from start) of the biggest moment, shown first when style["flash"] is on.
    zooms: loud windows (seconds from start) for the facecam push-in when style["zoom"] is on.
    base: video time of the local file's first second (a downloaded piece of a long stream starts hours in).
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    style = normalize(style, layout, captions)
    timings = {}
    t = time.perf_counter()
    if words_override is not None:
        clip_words = words_override
    else:
        clip_words = clip_caption_words(key, transcript, start, length, language)
        hook = (roman_line(key, hook) if language == "hi" else hook) if hook else None
    timings["hinglish_s"] = round(time.perf_counter() - t, 1)

    # Optional 1.5 s "flash" of the biggest moment before the story starts.
    flash = style["flash"] and peak is not None and length > FLASH * 3
    fs = max(0.0, min(length - FLASH, peak - FLASH / 2)) if flash else 0.0
    lead = FLASH if flash else 0.0
    shown = []
    if flash:
        shown += [{**w, "start": round(w["start"] - fs, 2), "end": round(min(FLASH, w["end"] - fs), 2)}
                  for w in clip_words if fs <= w["start"] < fs + FLASH - 0.1]
    shown += [{**w, "start": round(w["start"] + lead, 2), "end": round(w["end"] + lead, 2)} for w in clip_words]
    total = length + lead
    zoom_windows = [(a + lead, b + lead) for a, b in (zooms or [])] if style["zoom"] else []

    ass = out_dir / f"{name}.ass"
    # Inputs: (seek, length) segments of the source; with a flash, the peak first, then the story.
    segments = ([(start + fs, FLASH)] if flash else []) + [(start, length)]
    inputs: list[str] = []
    pairs = []  # (video input index, audio input index) per segment
    if remote:
        net = ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5", "-rw_timeout", "60000000", "-headers", remote["headers"]]
        for s, d in segments:
            vi = len(pairs) * (2 if remote.get("audio") else 1)
            inputs += ["-ss", str(s), "-t", str(d), *net, "-i", remote["video"]]
            ai = vi
            if remote.get("audio"):
                inputs += ["-ss", str(s), "-t", str(d), *net, "-i", remote["audio"]]
                ai = vi + 1
            pairs.append((vi, ai))
        size = (remote["width"], remote["height"])
    else:
        assert video is not None
        for n, (s, d) in enumerate(segments):
            inputs += ["-ss", f"{max(0.0, s - base):.3f}", "-t", str(d), "-i", str(video)]
            pairs.append((n, n))
        size = video_size(video)
    if len(pairs) > 1:
        joined = "".join(f"[{v}:v][{a}:a]" for v, a in pairs)
        pre, src, audio = f"{joined}concat=n={len(pairs)}:v=1:a=1[cv][ca];", "[cv]", "[ca]"
    else:
        pre, src, audio = "", f"[{pairs[0][0]}:v]", f"{pairs[0][1]}:a"
    # One copy of the source goes to a full-size picture of this moment (the Edit tab's live preview).
    pre += f"{src}split=2[src0][src1];"
    lf, where = layout_filter(*size, style, box, "[src0]", layout, zoom_windows)
    build_ass(shown, ass, hook, style, where["gap_y"], total)

    t = time.perf_counter()
    cover_y, cover_h = where["cover"]
    at = round(min(style["hook"]["sec"] + lead + 1.5, total * 0.5), 2)
    bar = (f",drawbox=x=0:y=ih-14:w='iw*t/{total:.2f}':h=14:color=0x{style['progressColor'][1:]}@1:t=fill"
           if style["progress"] else "")
    fonts = "fontsdir=fonts:" if FONT_DIR.exists() else ""
    # One pass, two outputs: the short, and a clean cover frame of the gameplay part (before captions).
    vf = (f"{pre}{lf};[v0]split=2[m][p];[m]subtitles=filename={ass.name}:{fonts}charenc=UTF-8{bar}[v];"
          f"[p]select='gte(t\\,{at})',crop=iw:{cover_h}:0:{cover_y},scale=480:-2[pv];"
          f"[src1]select='gte(t\\,{at})',scale=1280:-2[fr]")
    # Fonts are found relative to the output folder, so copy them in once.
    if fonts and not (out_dir / "fonts").exists():
        (out_dir / "fonts").mkdir(exist_ok=True)
        for f in FONT_DIR.glob("*.ttf"):
            (out_dir / "fonts" / f.name).write_bytes(f.read_bytes())
    r = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", vf,
         "-t", f"{total:.2f}", "-map", "[v]", "-map", audio,
         *encoder_args(), "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", f"{name}.mp4",
         "-map", "[pv]", "-frames:v", "1", "-update", "1", "-q:v", "3", f"{name}.jpg",
         "-map", "[fr]", "-frames:v", "1", "-update", "1", "-q:v", "4", f"{name}.frame.jpg"],
        cwd=out_dir, capture_output=True, text=True,
    )
    if r.returncode:
        raise RuntimeError(f"FFmpeg failed for {name} (exit code {r.returncode}):\n{r.stderr[-1500:]}")
    timings["render_s"] = round(time.perf_counter() - t, 1)
    if not (out_dir / f"{name}.jpg").exists():  # fallback cover from the finished short
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(at), "-i", f"{name}.mp4", "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", f"{name}.jpg"],
                       cwd=out_dir, capture_output=True)
    frame = f"{name}.frame.jpg" if (out_dir / f"{name}.frame.jpg").exists() else None
    return {"file": f"{name}.mp4", "poster": f"{name}.jpg", "frame": frame, "hook": hook, "words": clip_words, "timings": timings, "style": style}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=Path)
    ap.add_argument("start", type=float)
    ap.add_argument("length", type=float)
    ap.add_argument("--name", default="clip")
    ap.add_argument("--hook")
    ap.add_argument("--style", type=Path, help="JSON style file (style.py)")
    ap.add_argument("--peak", type=float)
    a = ap.parse_args()
    video = a.video.resolve()
    transcript = json.loads((video.parent / "signals" / f"{video.stem}.transcript.json").read_text(encoding="utf-8"))
    st = json.loads(a.style.read_text(encoding="utf-8")) if a.style else None
    res = render_short(video, a.start, a.length, video.parent / "shorts", a.name, load_key(), transcript, a.hook, style=st, peak=a.peak)
    print(f"{len(res['words'])} caption words. Timings: {res['timings']}")


if __name__ == "__main__":
    main()
