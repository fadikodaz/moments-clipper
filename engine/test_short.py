"""
The "Make a 5-second test" button: renders 5 seconds of the video with the chosen look, using
sample caption words (the real words are only known once the video has been listened to).

Usage:  python test_short.py <job_dir> <source file or link> <second> <style.json> [--hook "text"] [--n 1]
Writes: <job_dir>/setup/test-<n>.mp4 and <job_dir>/setup/test.json {"state", "file", "error"}
"""

import quiet  # noqa: F401  (must come first: hides helper windows on Windows)
import argparse
import json
import os
import time
import traceback
from pathlib import Path

from fetch import is_url, remote_source
from make_short import render_short
from transcribe import load_key

SAMPLE = "this is how your captions will look on every short oh my gosh chat let's go".split()


def write(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    for _ in range(40):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.05)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("job_dir", type=Path)
    ap.add_argument("source")
    ap.add_argument("second", type=float)
    ap.add_argument("style", type=Path)
    ap.add_argument("--hook", default="This is your opening line")
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--box", help="detected facecam box as JSON, used when none was drawn")
    a = ap.parse_args()
    out = a.job_dir / "setup"
    state = out / "test.json"
    write(state, {"state": "running", "started": time.time()})
    try:
        style = json.loads(a.style.read_text(encoding="utf-8"))
        style["flash"] = False  # a 5-second sample has no story to tease
        length = 5.0
        step = length / len(SAMPLE)
        words = [{"text": w, "start": round(i * step, 2), "end": round((i + 0.9) * step, 2)} for i, w in enumerate(SAMPLE)]
        remote = remote_source(a.source) if is_url(a.source) else None
        name = f"test-{a.n}"
        box = json.loads(a.box) if a.box else None
        render_short(None if remote else Path(a.source), a.second, length, out, name, load_key(), {"words": []}, a.hook,
                     remote=remote, box=box, words_override=words, style=style, zooms=[(1.5, 3.0)], language="en")
        (out / f"{name}.jpg").unlink(missing_ok=True)
        (out / f"{name}.ass").unlink(missing_ok=True)
        write(state, {"state": "done", "file": f"{name}.mp4", "updated": time.time()})
    except BaseException as e:
        traceback.print_exc()
        msg = str(e) or e.__class__.__name__
        write(state, {"state": "failed", "error": "The test couldn't be made. Try once more." if msg.startswith("FFmpeg") else msg[-300:], "updated": time.time()})
        raise SystemExit(1)
    finally:
        a.style.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
