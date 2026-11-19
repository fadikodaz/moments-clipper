"""
Find the facecam box automatically.

A facecam overlay stays in the same place for the whole stream while the game around it keeps
changing. So across ~16 frames spread over the video, the overlay's edges show up as lines that
are strong in *every* frame, while game edges move around and average out.

We look in the corner the user picked (or every corner if unsure), find the vertical and horizontal
line that best separate a rectangle from the rest, and check that the result is a sensible size.
If nothing convincing is found, the caller falls back to the default box.
"""

import subprocess
from concurrent.futures import ThreadPoolExecutor

import numpy as np

W, H = 320, 180  # frames are analysed small; the box is scaled back to the source size


def grab(input_args: list[str]) -> np.ndarray | None:
    r = subprocess.run(["ffmpeg", "-v", "error", *input_args, "-frames:v", "1", "-vf", f"scale={W}:{H},format=gray",
                        "-f", "rawvideo", "-"], capture_output=True, timeout=90)
    if r.returncode or len(r.stdout) != W * H:
        return None
    return np.frombuffer(r.stdout, dtype=np.uint8).reshape(H, W).astype(np.float32)


def sample_frames(duration: float, input_for, n: int = 16) -> np.ndarray:
    """input_for(t) returns the FFmpeg input arguments that seek to second t."""
    times = np.linspace(duration * 0.08, duration * 0.92, n)
    with ThreadPoolExecutor(max_workers=4) as pool:
        frames = [f for f in pool.map(lambda t: grab(input_for(float(t))), times) if f is not None]
    return np.stack(frames) if len(frames) >= 6 else np.empty((0, H, W))


def detect(frames: np.ndarray, corner: str) -> dict | None:
    """Returns {"x","y","w","h","confidence"} as fractions of the frame, or None."""
    if not len(frames) or corner == "none":
        return None
    gx = np.median(np.abs(np.diff(frames, axis=2)), axis=0)  # vertical lines (H, W-1)
    gy = np.median(np.abs(np.diff(frames, axis=1)), axis=0)  # horizontal lines (H-1, W)
    base = float(np.median(np.concatenate([gx.ravel(), gy.ravel()]))) + 1.0

    right, top = corner.endswith("right"), corner.startswith("top")
    best = None
    # The inner vertical edge of a corner facecam sits 10-45% of the width in from its side,
    # the inner horizontal edge 12-60% of the height in from its side.
    xs = range(int(W * 0.55), int(W * 0.90)) if right else range(int(W * 0.10), int(W * 0.45))
    ys = range(int(H * 0.12), int(H * 0.60)) if top else range(int(H * 0.40), int(H * 0.88))
    for x in xs:
        for y in ys:
            rows = slice(0, y) if top else slice(y, H)
            cols = slice(x, W - 1) if right else slice(0, x)
            v = float(gx[rows, x].mean())                    # strength of the side edge along the box
            hz = float(gy[y if top else y - 1, cols].mean())  # strength of the top/bottom edge along the box
            w_px = (W - x) if right else x
            h_px = y if top else (H - y)
            aspect = (w_px * 16 / W) / (h_px * 9 / H)  # in real pixels; webcams are about 4:3 to 16:9
            if not 0.9 <= aspect <= 2.2:
                continue
            score = min(v, hz)  # both edges must be strong, not just one
            if best is None or score > best[0]:
                best = (score, x, y, w_px, h_px)
    if best is None:
        return None
    score, x, y, w_px, h_px = best
    confidence = score / base
    if confidence < 3.0:  # edges barely stronger than the rest: probably no overlay here
        return None
    return {"x": (x + 1) / W if right else 0.0, "y": 0.0 if top else (y + 1) / H,
            "w": w_px / W, "h": h_px / H, "confidence": round(confidence, 1)}


def find_facecam(duration: float, input_for, corner: str) -> dict | None:
    frames = sample_frames(duration, input_for)
    if corner != "auto":
        return detect(frames, corner)
    found = [d for c in ("top-right", "top-left", "bottom-right", "bottom-left") if (d := detect(frames, c))]
    return max(found, key=lambda d: d["confidence"]) if found else None
