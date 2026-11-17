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
from pathlib import Path

# 720p H.264 + AAC: plays everywhere, decodes fast, and keeps transfers small.
VIDEO_FORMAT = "bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/b[height<=720][vcodec^=avc1]/bv*[height<=720]+ba/b[height<=720]"
AUDIO_FORMAT = "ba[ext=m4a]/ba"
BASE = [sys.executable, "-m", "yt_dlp", "--no-warnings", "--no-playlist", "--js-runtimes", "node"]


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
    if "sign in to confirm you" in s and "bot" in s:
        return "YouTube is asking this computer to prove it's not a bot. Try again later, or upload the file instead."
    return "Couldn't get this video from YouTube: " + (stderr.strip().splitlines() or ["unknown error"])[-1][:300]


def info(url: str, fmt: str = VIDEO_FORMAT) -> dict:
    r = subprocess.run(BASE + ["-J", "-f", fmt, url], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    if r.returncode or not r.stdout.strip():
        raise FetchError(friendly(r.stderr))
    return json.loads(r.stdout)


def _download(url: str, fmt: str, out: Path, on_progress=None, merge: bool = False) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    args = BASE + ["-f", fmt, "--newline", "--progress-template", "download:PCT %(progress._percent_str)s", "-o", str(out.with_suffix(".%(ext)s"))]
    if merge:
        args += ["--merge-output-format", "mp4"]
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


def download_audio(url: str, out: Path, on_progress=None) -> Path:
    return _download(url, AUDIO_FORMAT, out, on_progress)


def download_video(url: str, out: Path, on_progress=None) -> Path:
    return _download(url, VIDEO_FORMAT, out, on_progress, merge=True)


def remote_source(url: str) -> dict:
    """Direct stream addresses for FFmpeg. They expire after a few hours, so fetch them right before cutting."""
    data = info(url)
    fmts = data.get("requested_formats") or [data]
    video = next((f for f in fmts if f.get("vcodec") not in (None, "none")), fmts[0])
    audio = next((f for f in fmts if f is not video and f.get("acodec") not in (None, "none")), None)
    headers = "".join(f"{k}: {v}\r\n" for k, v in (video.get("http_headers") or {}).items())
    return {"video": video["url"], "audio": audio["url"] if audio else None, "headers": headers,
            "width": int(video.get("width") or 1280), "height": int(video.get("height") or 720)}
