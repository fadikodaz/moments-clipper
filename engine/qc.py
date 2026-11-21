"""
Quality check of a finished short: pass / warn / fail with plain-language reasons.

One FFmpeg pass over the file measures loudness (EBU R128), black frames, a frozen picture and silence.
Checks follow the idea of gta6-clipper's qc.py (MIT, NoCodeHack), with our own thresholds.

    from qc import check
    check(Path("01_name.mp4"), expected=72.0)
    -> {"status": "pass"|"warn"|"fail", "problems": [{"level", "text"}], "lufs", "duration", "black_s", "frozen_s", "silence_pct"}

    python qc.py <short.mp4 | folder>   prints the result per short
"""

import json
import re
import subprocess
import sys
from pathlib import Path

LOUDNESS = -14.0


def _run(path: Path) -> str:
    vf = "blackdetect=d=0.4:pix_th=0.10,freezedetect=n=-60dB:d=2"
    af = "ebur128=peak=true,silencedetect=n=-40dB:d=1.5"
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vf", vf, "-af", af, "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
    return r.stderr


def _duration(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def check(path: Path, expected: float | None = None) -> dict:
    path = Path(path)
    if not path.exists() or path.stat().st_size < 10_000:
        return {"status": "fail", "problems": [{"level": "fail", "text": "The video file is missing or broken."}]}
    dur = _duration(path)
    log = _run(path)
    lufs = re.findall(r"I:\s+(-?[\d.]+) LUFS", log)
    lufs = float(lufs[-1]) if lufs else None
    black = sum(float(x) for x in re.findall(r"black_duration:([\d.]+)", log))
    frozen = sum(float(x) for x in re.findall(r"freeze_duration: ([\d.]+)", log))
    silent = sum(float(x) for x in re.findall(r"silence_duration: ([\d.]+)", log))
    # silence still running at the end is reported without a duration
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
    if len(starts) > len(re.findall(r"silence_end:", log)) and starts:
        silent += max(0.0, dur - starts[-1])
    silence_pct = round(100 * silent / dur) if dur else 0

    p = []
    if dur < 10:
        p.append(("fail", f"Only {dur:.0f} s long: too short to post."))
    elif expected and abs(dur - expected) > max(4.0, 0.15 * expected):
        p.append(("warn", f"{dur:.0f} s long instead of the planned {expected:.0f} s."))
    if dur > 180:
        p.append(("warn", f"{dur:.0f} s long: Shorts over 3 minutes are not shown as Shorts."))
    if lufs is None:
        p.append(("fail", "No sound found."))
    elif lufs < LOUDNESS - 3:
        p.append(("warn", f"Quieter than normal ({lufs:.0f} LUFS; platforms play at {LOUDNESS:.0f})."))
    elif lufs > LOUDNESS + 3:
        p.append(("warn", f"Louder than normal ({lufs:.0f} LUFS)."))
    if black >= 1.0:
        p.append(("fail" if black >= 3 else "warn", f"Black screen for {black:.1f} s."))
    if frozen >= 3.0:
        p.append(("fail" if frozen >= 6 else "warn", f"The picture stands still for {frozen:.0f} s (loading screen or lost video?)."))
    if silence_pct >= 40:
        p.append(("fail", f"Silent for {silence_pct}% of the short."))
    elif silence_pct >= 20:
        p.append(("warn", f"Silent for {silence_pct}% of the short."))

    status = "fail" if any(lv == "fail" for lv, _ in p) else "warn" if p else "pass"
    return {"status": status, "problems": [{"level": lv, "text": t} for lv, t in p], "lufs": lufs, "duration": round(dur, 1),
            "black_s": round(black, 1), "frozen_s": round(frozen, 1), "silence_pct": silence_pct}


def safe_check(path: Path) -> dict | None:
    """check() that never breaks making a short."""
    try:
        return check(path)
    except Exception as e:  # noqa: BLE001
        print(f"    quality check skipped: {e}", flush=True)
        return None


if __name__ == "__main__":
    target = Path(sys.argv[1])
    files = sorted(target.glob("[0-9][0-9]_*.mp4")) if target.is_dir() else [target]
    for f in files:
        r = check(f)
        print(f"{r['status'].upper():4}  {f.name[:40]:40}  {r.get('lufs')} LUFS  {r.get('duration')} s  " +
              ("; ".join(x["text"] for x in r["problems"]) or "ok"))
        sys.stdout.flush()
    if len(files) == 1:
        print(json.dumps(r, indent=1))
