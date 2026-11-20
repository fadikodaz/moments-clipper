"""
For the "Set up your shorts" screen, before anything is made: 4 big frames from across the video
(or the chosen part) and the facecam box found automatically.

Usage:  python setup_probe.py <job_dir> <source file or link> [--from SEC --to SEC]
Writes: <job_dir>/setup/frame1.jpg .. frame4.jpg and <job_dir>/setup/probe.json
        {"state": "done"|"failed", "frames": [{"file", "t"}], "box": {...}|null, "width", "height", "error"}
"""

import quiet  # noqa: F401  (must come first: hides helper windows on Windows)
import argparse
import json
import os
import subprocess
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from facecam import find_facecam
from fetch import FetchError, has_pieces, is_url, remote_source, segment_frame_input


def write(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    for _ in range(40):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.05)


def duration(path: str) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("job_dir", type=Path)
    ap.add_argument("source")
    ap.add_argument("--from", dest="lo", type=float)
    ap.add_argument("--to", dest="hi", type=float)
    ap.add_argument("--duration", type=float, help="length of a linked video, if known")
    a = ap.parse_args()
    out = a.job_dir / "setup"
    out.mkdir(parents=True, exist_ok=True)
    state = out / "probe.json"
    write(state, {"state": "running", "started": time.time()})
    try:
        lo_input_for = None
        if is_url(a.source):
            try:
                fast = has_pieces(a.source)
            except FetchError:
                fast = False
            if fast:
                # One 5-second piece per picture, downloaded in parallel: far quicker than seeking in the stream.
                cache = out / "pieces"
                input_for = lambda t: segment_frame_input(a.source, t, "hi", cache)
                lo_input_for = lambda t: segment_frame_input(a.source, t, "lo", cache)
                size = (1280, 720)
            else:
                rs = remote_source(a.source)
                input_for = lambda t: ["-ss", str(t), "-headers", rs["headers"], "-i", rs["video"]]
                size = (rs["width"], rs["height"])
            total = a.duration or 0
        else:
            input_for = lambda t: ["-ss", str(t), "-i", a.source]
            r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", a.source],
                               capture_output=True, text=True)
            w, h = (r.stdout.strip().split(",") + ["0", "0"])[:2]
            size = (int(w or 0), int(h or 0))
            total = duration(a.source)
        lo = a.lo or 0.0
        hi = a.hi or total or lo + 3600
        span = max(60.0, hi - lo)
        times = [round(lo + span * f) for f in (0.15, 0.38, 0.62, 0.85)]

        def bright(f: Path) -> float:
            r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(f), "-vf", "scale=32:18,format=gray", "-f", "rawvideo", "-"], capture_output=True)
            return sum(r.stdout) / max(1, len(r.stdout))

        def grab(i_t):
            i, t = i_t
            f = out / f"frame{i + 1}.jpg"
            # Loading screens and fades are black: try a little later, up to 3 times.
            for k in range(3):
                f.unlink(missing_ok=True)
                subprocess.run(["ffmpeg", "-y", "-v", "error", *input_for(t + k * 45), "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "3", str(f)],
                               capture_output=True, timeout=120)
                if f.exists() and bright(f) > 25:
                    return {"file": f.name, "t": t + k * 45}
            return {"file": f.name, "t": t} if f.exists() else None

        with ThreadPoolExecutor(max_workers=4) as pool:  # each picture's piece downloads in parallel too
            frames = [f for f in pool.map(grab, enumerate(times)) if f]
        if not frames:
            raise RuntimeError("Couldn't read any picture from the video.")
        # The facecam search reads its own 16 small frames from the same part.
        box = find_facecam(span, lambda t: (lo_input_for or input_for)(t + lo), "auto")
        for f in (out / "pieces").glob("*"):
            f.unlink(missing_ok=True)
        write(state, {"state": "done", "frames": frames, "box": box, "width": size[0], "height": size[1], "updated": time.time()})
        print("probe:", frames, box, flush=True)
    except BaseException as e:  # the website must always learn how it ended
        traceback.print_exc()
        write(state, {"state": "failed", "error": (str(e) or e.__class__.__name__)[-300:], "updated": time.time()})
        raise SystemExit(1)


if __name__ == "__main__":
    main()
