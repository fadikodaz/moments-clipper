"""
Getting video from a link (YouTube for now) without downloading the whole thing.

  1. info()            title, length, live/age flags, and direct stream addresses (no download)
  2. download_audio()  audio only (~50 MB per hour): all the engine needs to listen and pick moments
  3. remote_source()   direct video/audio addresses, so FFmpeg cuts each picked moment straight
                       from YouTube's servers (only those seconds are transferred)
  4. download_video()  fallback when YouTube refuses partial reads: the full video at 720p

Uses the yt-dlp command (same Python install) with Node as its JavaScript runtime.
"""

import json
import re
import subprocess
import sys
import time
from pathlib import Path

# 720p H.264 + AAC: plays everywhere, decodes fast, and keeps transfers small.
VIDEO_FORMAT = "bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/b[height<=720][vcodec^=avc1]/bv*[height<=720]+ba/b[height<=720]"
# Smallest AAC first (about 20 MB per hour): speech-to-text only needs 16 kHz anyway.
AUDIO_FORMAT = "139/ba[ext=m4a]/ba"
BASE = [sys.executable, "-m", "yt_dlp", "--no-warnings", "--no-playlist", "--js-runtimes", "node", "--retries", "5", "--fragment-retries", "5"]
ATTEMPTS = 3  # YouTube randomly refuses a download address (HTTP 403); a fresh request usually works


class FetchError(RuntimeError):
    pass


def is_url(s: str) -> bool:
    return bool(re.match(r"^https?://", s, re.I))


def friendly(stderr: str) -> str:
    s = stderr.lower()
    if "sign in to confirm your age" in s or "age-restricted" in s:
        return "This video is age-restricted on YouTube, so it can't be fetched without signing in. Download it and upload the file instead."
    if "private video" in s:
        return "This video is private on YouTube."
    if "members-only" in s or "join this channel" in s:
        return "This video is for channel members only."
    if "video unavailable" in s or "not available" in s:
        return "YouTube says this video is unavailable."
    if "403" in s or "forbidden" in s:
        return "YouTube refused the download several times in a row. Wait a few minutes and try again, or upload the file instead."
    if "sign in to confirm you" in s and "bot" in s:
        return "YouTube is asking this computer to prove it's not a bot. Try again later, or upload the file instead."
    return "Couldn't get this video from YouTube: " + (stderr.strip().splitlines() or ["unknown error"])[-1][:300]


def info(url: str, fmt: str = VIDEO_FORMAT) -> dict:
    for attempt in range(1, ATTEMPTS + 1):
        r = subprocess.run(BASE + ["-J", "-f", fmt, url], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
        if r.returncode == 0 and r.stdout.strip():
            return json.loads(r.stdout)
        msg = friendly(r.stderr)
        if attempt == ATTEMPTS or any(w in msg.lower() for w in PERMANENT):
            raise FetchError(msg)
        time.sleep(3 * attempt)
    raise FetchError("unreachable")


PERMANENT = ("age-restricted", "private", "members", "unavailable", "live")


def _download(url: str, fmt: str, out: Path, on_progress=None, merge: bool = False, on_retry=None, section: tuple[float, float] | None = None) -> Path:
    """Retries with a fresh request when YouTube refuses; permanent problems (private, age) fail at once."""
    for attempt in range(1, ATTEMPTS + 1):
        try:
            return _download_once(url, fmt, out, on_progress, merge, section)
        except FetchError as e:
            if attempt == ATTEMPTS or any(w in str(e).lower() for w in PERMANENT):
                raise
            print(f"    download attempt {attempt} refused: {e}", flush=True)
            for f in out.parent.glob(out.stem + ".*"):
                f.unlink(missing_ok=True)
            if on_retry:
                on_retry(attempt + 1, ATTEMPTS)
            time.sleep(3 * attempt)
    raise FetchError("unreachable")


def _download_once(url: str, fmt: str, out: Path, on_progress=None, merge: bool = False, section: tuple[float, float] | None = None) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    args = BASE + ["-f", fmt, "--newline", "--progress-template", "download:PCT %(progress._percent_str)s", "-o", str(out.with_suffix(".%(ext)s"))]
    if merge:
        args += ["--merge-output-format", "mp4"]
    if section:  # only this part of a long stream (seconds from the start)
        args += ["--download-sections", f"*{int(section[0])}-{int(section[1])}"]
    p = subprocess.Popen(args + [url], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    for line in p.stdout:  # type: ignore[union-attr]
        m = re.search(r"PCT\s+([\d.]+)%", line)
        if m and on_progress:
            on_progress(float(m.group(1)) / 100)
    err = p.stderr.read() if p.stderr else ""
    if p.wait():
        raise FetchError(friendly(err))
    files = sorted(out.parent.glob(out.stem + ".*"), key=lambda f: f.stat().st_size, reverse=True)
    files = [f for f in files if f.suffix not in (".part", ".ytdl")]
    if not files:
        raise FetchError("The download finished but no file was saved.")
    return files[0]


def download_audio(url: str, out: Path, on_progress=None, on_retry=None, section: tuple[float, float] | None = None) -> Path:
    return _download(url, AUDIO_FORMAT, out, on_progress, on_retry=on_retry, section=section)


def download_video(url: str, out: Path, on_progress=None, on_retry=None) -> Path:
    return _download(url, VIDEO_FORMAT, out, on_progress, merge=True, on_retry=on_retry)


def remote_source(url: str) -> dict:
    """Direct stream addresses for FFmpeg. They expire after a few hours, so fetch them right before cutting."""
    data = info(url)
    fmts = data.get("requested_formats") or [data]
    video = next((f for f in fmts if f.get("vcodec") not in (None, "none")), fmts[0])
    audio = next((f for f in fmts if f is not video and f.get("acodec") not in (None, "none")), None)
    headers = "".join(f"{k}: {v}\r\n" for k, v in (video.get("http_headers") or {}).items())
    return {"video": video["url"], "audio": audio["url"] if audio else None, "headers": headers,
            "width": int(video.get("width") or 1280), "height": int(video.get("height") or 720)}


# ---------------- pieces: only the seconds we need, many small requests at once ----------------
# YouTube also serves every video as an HLS playlist of 5-second pieces. One connection is often slowed
# down to a crawl; 8 pieces at a time come in 10-15x faster. A "piece" here is a short local file
# covering a time range of the video, with "base" = the video time of its first frame.

import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor

import requests

_hls_lock = threading.Lock()
_hls_info: dict[str, tuple[float, dict]] = {}
WORKERS = 8


def _formats(url: str) -> dict | None:
    """HLS video (720p H.264 or the best below) and audio formats, cached for 2 hours (addresses expire later)."""
    with _hls_lock:
        hit = _hls_info.get(url)
        if hit and time.time() - hit[0] < 7200:
            return hit[1]
    r = subprocess.run(BASE + ["-J", url], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    if r.returncode or not r.stdout.strip():
        raise FetchError(friendly(r.stderr))
    data = json.loads(r.stdout)
    hls = [f for f in data.get("formats", []) if str(f.get("protocol", "")).startswith("m3u8")]
    vids = sorted((f for f in hls if str(f.get("vcodec", "")).startswith("avc1") and (f.get("height") or 0) <= 720),
                  key=lambda f: (f.get("height") or 0, -(f.get("fps") or 0)), reverse=True)
    auds = {f["format_id"]: f for f in hls if f.get("vcodec") in (None, "none")}
    out = None
    if vids and auds:
        low = [f for f in vids if (f.get("height") or 0) <= 360]
        out = {"video": vids[0], "video_lo": min(low, key=lambda f: abs((f.get("height") or 0) - 240)) if low else vids[-1], "audio_hi": auds.get("234") or next(iter(auds.values())), "audio_lo": auds.get("233") or next(iter(auds.values())),
               "duration": float(data.get("duration") or 0)}
    with _hls_lock:
        _hls_info[url] = (time.time(), out)
    return out


def _segments(fmt: dict) -> list[tuple[float, float, str]]:
    """(start second, length, address) of every piece in a playlist."""
    for attempt in range(3):
        try:
            r = requests.get(fmt["url"], headers=fmt.get("http_headers") or {}, timeout=60)
            r.raise_for_status()
            break
        except requests.RequestException:
            if attempt == 2:
                raise FetchError("Couldn't read the video's piece list from YouTube.")
            time.sleep(3)
    lines, out, t = r.text.splitlines(), [], 0.0
    for i, line in enumerate(lines):
        if line.startswith("#EXTINF:") and i + 1 < len(lines):
            d = float(line.split(":", 1)[1].split(",")[0])
            out.append((t, d, lines[i + 1].strip()))
            t += d
    if not out:
        raise FetchError("YouTube sent an empty piece list.")
    return out


def _fetch_all(segs: list[tuple[float, float, str]], out: Path, on_progress=None) -> None:
    """Download pieces in parallel and join them in order into one file."""
    parts: list[bytes | None] = [None] * len(segs)
    done = 0
    lock = threading.Lock()

    def get(i: int) -> None:
        nonlocal done
        for attempt in range(5):
            try:
                r = requests.get(segs[i][2], timeout=60)
                r.raise_for_status()
                parts[i] = r.content
                break
            except requests.RequestException:
                time.sleep(1 + attempt * 2)
        with lock:
            done += 1
            if on_progress:
                on_progress(done / len(segs))

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(get, range(len(segs))))
    if any(p is None for p in parts):
        raise FetchError("Some pieces of the video couldn't be downloaded. Try again.")
    with out.open("wb") as f:
        for p in parts:
            f.write(p)  # type: ignore[arg-type]


def download_range(url: str, start: float, end: float, out: Path, video: bool = True, audio: str = "hi", on_progress=None) -> dict | None:
    """Only the seconds start..end of a linked video, fetched in parallel pieces.
    Returns {"file": Path, "base": video time of the file's first second}, or None if YouTube has no pieces for it."""
    fmts = _formats(url)
    if not fmts:
        return None
    out.parent.mkdir(parents=True, exist_ok=True)
    pick = lambda segs: [s for s in segs if s[0] + s[1] > start and s[0] < end]
    a_segs = pick(_segments(fmts["audio_hi" if audio == "hi" else "audio_lo"]))
    if not a_segs:
        raise FetchError("That part of the video is outside its length.")
    tmp = out.with_name(out.stem + ".parts")
    tmp.mkdir(exist_ok=True)
    try:
        if not video:
            _fetch_all(a_segs, tmp / "a.ts", on_progress)
            cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(tmp / "a.ts"), "-c", "copy", "-bsf:a", "aac_adtstoasc", str(out)]
            base = a_segs[0][0]
        else:
            v_segs = pick(_segments(fmts["video"]))
            n_v, n_a = len(v_segs), len(a_segs)
            _fetch_all(v_segs, tmp / "v.ts", (lambda f: on_progress(f * n_v / (n_v + n_a))) if on_progress else None)
            _fetch_all(a_segs, tmp / "a.ts", (lambda f: on_progress((n_v + f * n_a) / (n_v + n_a))) if on_progress else None)
            base = v_segs[0][0]
            # Audio pieces can start at a slightly different second than video pieces: line them up.
            shift = a_segs[0][0] - base
            cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(tmp / "v.ts"), "-itsoffset", f"{shift:.3f}", "-i", str(tmp / "a.ts"),
                   "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", str(out)]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode:
            raise FetchError(f"Joining the downloaded pieces failed: {r.stderr[-300:]}")
    finally:
        for f in tmp.glob("*"):
            f.unlink(missing_ok=True)
        tmp.rmdir()
    return {"file": out, "base": round(base, 3)}


def segment_frame_input(url: str, t: float, quality: str = "hi", cache: Path | None = None) -> list[str]:
    """FFmpeg input arguments for a single picture at second t, from the one 5-second piece that holds it
    (downloaded once into cache). quality "lo" (240p) is plenty for finding the facecam."""
    fmts = _formats(url)
    if not fmts:
        raise FetchError("No pieces available for this video.")
    key = "video" if quality == "hi" else "video_lo"
    fmt = fmts.get(key) or fmts["video"]
    with _hls_lock:
        segs = _seg_cache.get(fmt["url"])
    if segs is None:
        segs = _segments(fmt)
        with _hls_lock:
            _seg_cache[fmt["url"]] = segs
    seg = next((s for s in segs if s[0] <= t < s[0] + s[1]), segs[-1])
    cache = cache or Path(tempfile.gettempdir()) / "moments-pieces"
    cache.mkdir(parents=True, exist_ok=True)
    f = cache / f"{quality}-{int(seg[0] * 1000)}.ts"
    if not f.exists():
        _fetch_all([seg], f)
    # Seek after opening (decode up to the second): exact, and works even when the piece's timestamps start late.
    return ["-i", str(f), "-ss", f"{max(0.0, min(t - seg[0], seg[1] - 0.2)):.2f}"]


_seg_cache: dict[str, list] = {}


def has_pieces(url: str) -> bool:
    """True when YouTube offers this video in 5-second pieces (fast parallel download)."""
    return _formats(url) is not None
