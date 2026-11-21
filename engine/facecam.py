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
from pathlib import Path

import numpy as np

W, H = 320, 180  # frames are analysed small; the box is scaled back to the source size
FW, FH = 640, 360  # frames for the face finder (faces in a facecam are only ~20 px wide at 320)
MODEL = Path(__file__).with_name("models") / "yunet.onnx"


def grab(input_args: list[str], w: int = W, h: int = H) -> np.ndarray | None:
    """One small colour frame, (h, w, 3) RGB."""
    r = subprocess.run(["ffmpeg", "-v", "error", *input_args, "-frames:v", "1", "-vf", f"scale={w}:{h},format=rgb24",
                        "-f", "rawvideo", "-"], capture_output=True, timeout=90)
    if r.returncode or len(r.stdout) != w * h * 3:
        return None
    return np.frombuffer(r.stdout, dtype=np.uint8).reshape(h, w, 3).astype(np.float32)


def gray(frames: np.ndarray) -> np.ndarray:
    return frames.mean(axis=-1) if frames.ndim == 4 else frames


def skin_share(frames: np.ndarray, box: dict) -> float:
    """Typical share of skin-coloured pixels inside the box (YCbCr rule, works across skin tones).
    A webcam showing a person scores clearly above zero; a game minimap or HUD scores about zero."""
    if frames.ndim != 4:
        return 0.0
    x0, y0 = int(box["x"] * W), int(box["y"] * H)
    part = frames[:, y0: y0 + max(1, int(box["h"] * H)), x0: x0 + max(1, int(box["w"] * W))]
    r, g, b = part[..., 0], part[..., 1], part[..., 2]
    cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    y = 0.299 * r + 0.587 * g + 0.114 * b
    skin = (cb >= 77) & (cb <= 127) & (cr >= 137) & (cr <= 173) & (y > 40)
    # Median over frames: a person is there in nearly every frame, while a map or HUD only turns
    # skin-coloured now and then (desert, sunsets).
    return float(np.median(skin.reshape(len(skin), -1).mean(axis=1)))


def sample_frames(duration: float, input_for, n: int = 16, w: int = W, h: int = H) -> np.ndarray:
    """input_for(t) returns the FFmpeg input arguments that seek to second t."""
    times = np.linspace(duration * 0.08, duration * 0.92, n)
    with ThreadPoolExecutor(max_workers=8) as pool:
        frames = [f for f in pool.map(lambda t: grab(input_for(float(t)), w, h), times) if f is not None]
    return np.stack(frames) if len(frames) >= 6 else np.empty((0, h, w))


def shrink(frames: np.ndarray) -> np.ndarray:
    """Face-finder frames down to the edge-finder size (2x2 average)."""
    if not len(frames):
        return np.empty((0, H, W, 3), np.float32)
    n, h, w, c = frames.shape
    return frames.reshape(n, H, h // H, W, w // W, c).mean(axis=(2, 4))


def faces(frames: np.ndarray) -> list[list[tuple[float, float, float, float]]]:
    """Face boxes (x, y, w, h as fractions) in every frame, with OpenCV's YuNet model. [] per frame without faces;
    an empty list overall when OpenCV or the model is missing (then only the edge finder is used)."""
    try:
        import os
        os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")
        import cv2
        if not MODEL.exists() or not len(frames):
            return []
        cv2.setLogLevel(0) if hasattr(cv2, "setLogLevel") else None
        h, w = frames.shape[1:3]
        yn = cv2.FaceDetectorYN.create(str(MODEL), "", (w, h), 0.6)
    except Exception:
        return []
    out = []
    for f in frames:
        _, fs = yn.detect(np.ascontiguousarray(f[..., ::-1]).astype(np.uint8))  # model wants BGR
        out.append([(x / w, y / h, bw / w, bh / h) for x, y, bw, bh in ([] if fs is None else fs[:, :4])])
    return out


def face_cam(found: list[list[tuple]], share: float = 0.4) -> tuple[dict, list] | None:
    """The facecam = faces that stay in the same spot in most frames (game characters move around).
    Returns (box around those faces as fractions, the faces) or None. Two people side by side (a duo cam) share one box."""
    if len(found) < 6:
        return None
    # Tracks: a face joins the track whose centre is closest (within about one face width), one face per track per frame.
    tracks: list[dict] = []
    for i, fs in enumerate(found):
        for f in sorted(fs, key=lambda f: -f[2]):
            if f[2] > 0.15:  # a face this big is a full-screen webcam or a cutscene, not an overlay
                continue
            cx, cy = f[0] + f[2] / 2, f[1] + f[3] / 2
            near = [tr for tr in tracks if i not in tr["hits"] and abs(tr["cx"] - cx) < max(0.05, 0.9 * f[2]) and abs(tr["cy"] - cy) < max(0.06, 0.9 * f[3])]
            tr = min(near, key=lambda tr: abs(tr["cx"] - cx) + abs(tr["cy"] - cy), default=None)
            if tr is None:
                tr = {"hits": {}, "cx": cx, "cy": cy}
                tracks.append(tr)
            tr["hits"][i] = f
            ctr = np.array([(g[0] + g[2] / 2, g[1] + g[3] / 2) for g in tr["hits"].values()])
            tr["cx"], tr["cy"] = float(np.median(ctr[:, 0])), float(np.median(ctr[:, 1]))
    steady = []
    for tr in tracks:
        if len(tr["hits"]) < share * len(found):
            continue
        fs = list(tr["hits"].values())
        ctr = np.array([(f[0] + f[2] / 2, f[1] + f[3] / 2) for f in fs])
        if float(ctr.std(axis=0).max()) > 0.05:  # wanders around the screen: not an overlay
            continue
        steady.append((len(fs), fs))
    if not steady:
        return None
    # the main cam, plus a second steady face right next to it (two streamers in one cam)
    steady.sort(key=lambda s: -s[0])
    main = steady[0][1]
    med = lambda fs: np.median(np.array(fs), axis=0)
    m = med(main)
    people = [m]
    for n, fs in steady[1:]:
        o = med(fs)
        if abs(o[1] - m[1]) < 2 * m[3] and abs((o[0] + o[2] / 2) - (m[0] + m[2] / 2)) < 5 * m[2]:
            people.append(o)
    l = min(p[0] for p in people); r = max(p[0] + p[2] for p in people)
    t = min(p[1] for p in people); b = max(p[1] + p[3] for p in people)
    fw = float(np.median([p[2] for p in people])); fh = float(np.median([p[3] for p in people]))
    # head and shoulders: a margin around the faces, about 4:3 to 16:9 in real pixels
    bw = min(1.0, (r - l) + 2.4 * fw)
    bh = min(1.0, max((b - t) + 1.5 * fh, bw * 16 / 9 / 2.0))
    cx, top = (l + r) / 2, t - 0.8 * fh
    x0 = float(np.clip(cx - bw / 2, 0, 1 - bw)); y0 = float(np.clip(top, 0, 1 - bh))
    return {"x": round(x0, 4), "y": round(y0, 4), "w": round(float(bw), 4), "h": round(float(bh), 4)}, [tuple(float(v) for v in p) for p in people]


def contains(box: dict, people: list) -> bool:
    """Every face lies inside the box."""
    return all(box["x"] - 0.01 <= p[0] and p[0] + p[2] <= box["x"] + box["w"] + 0.01 and
               box["y"] - 0.01 <= p[1] and p[1] + p[3] <= box["y"] + box["h"] + 0.01 for p in people)


def detect(frames: np.ndarray, corner: str) -> dict | None:
    """Returns {"x","y","w","h","confidence"} as fractions of the frame, or None."""
    if not len(frames) or corner == "none":
        return None
    frames = gray(frames)
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


def detect_side(frames: np.ndarray, side: str, keep: int = 3) -> list[dict]:
    """A facecam against the left or right edge of the frame, at any height (corners included,
    e.g. Kai Cenat's cam sits halfway down on the left). Needs a strong inner side edge plus a strong
    top edge (unless it touches the top) and bottom edge (unless it touches the bottom).
    Every box is scored at once with running sums, so the search over all sizes stays fast."""
    if not len(frames):
        return []
    frames = gray(frames)
    gx = np.median(np.abs(np.diff(frames, axis=2)), axis=0)  # (H, W-1): vertical edges
    gy = np.median(np.abs(np.diff(frames, axis=1)), axis=0)  # (H-1, W): horizontal edges
    base = float(np.median(np.concatenate([gx.ravel(), gy.ravel()]))) + 1.0
    right = side == "right"
    # running sums: down each column of gx, and along each row of gy (from the box's outer side)
    col_cum = np.vstack([np.zeros((1, gx.shape[1])), np.cumsum(gx, axis=0)])         # (H+1, W-1)
    row_src = gy[:, ::-1] if right else gy
    row_cum = np.hstack([np.zeros((gy.shape[0], 1)), np.cumsum(row_src, axis=1)])    # (H-1, W+1)
    y0 = np.arange(H)[:, None]
    y1 = np.arange(H + 1)[None, :]
    tall = y1 - y0
    found = []
    for x in range(int(W * 0.10), int(W * 0.45)):         # inner edge 10-45% of the width from the side
        w_px = x
        col = (W - 1 - x) if right else x - 1             # column of the inner vertical edge in gx
        with np.errstate(divide="ignore", invalid="ignore"):
            v = (col_cum[y1, col] - col_cum[y0, col]) / np.maximum(tall, 1)
        h_edge = row_cum[:, w_px] / w_px                  # strength of each horizontal line across the box
        top = np.full(H, np.inf)
        top[1:] = h_edge[: H - 1]                         # top edge of a box starting at row y0 is gy[y0-1]
        bot = np.full(H + 1, np.inf)
        bot[1:H] = h_edge[: H - 1]                        # bottom edge of a box ending at row y1 is gy[y1-1]
        score = np.minimum(v, np.minimum(top[:, None], bot[None, :]))
        aspect = (w_px * 16 / W) / np.maximum(tall * 9 / H, 1e-6)
        ok = (tall >= H * 0.12) & (tall <= H * 0.75) & (aspect >= 0.9) & (aspect <= 2.2) & ~((y0 == 0) & (y1 == H))
        score = np.where(ok, score, -1)
        i = np.unravel_index(int(np.argmax(score)), score.shape)
        if score[i] / base >= 3.0:  # edges clearly stronger than the rest
            found.append((float(score[i]), x, int(i[0]), int(i[1])))
    # Several different boxes can qualify (a facecam and a game minimap): keep the strongest few that don't overlap.
    boxes: list[dict] = []
    for score, w_px, a, b in sorted(found, reverse=True):
        box = {"x": (W - w_px) / W if right else 0.0, "y": a / H, "w": w_px / W, "h": (b - a) / H, "confidence": round(score / base, 1)}
        if all(overlap(box, o) < 0.3 for o in boxes):
            boxes.append(box)
        if len(boxes) == keep:
            break
    return boxes


def overlap(a: dict, b: dict) -> float:
    """Intersection over the smaller box."""
    w = max(0.0, min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"]))
    h = max(0.0, min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"]))
    return w * h / max(1e-9, min(a["w"] * a["h"], b["w"] * b["h"]))


def find_facecam(duration: float, input_for, corner: str) -> dict | None:
    big = sample_frames(duration, input_for, w=FW, h=FH)
    frames = shrink(big)
    if corner != "auto":
        return detect(frames, corner)
    found = [d for s in ("left", "right") for d in detect_side(frames, s)]
    cam = face_cam(faces(big))
    if cam:
        box, people = cam
        # The edge finder's box has the overlay's exact border: use it when the faces are inside it.
        framed = [d for d in found if contains(d, people) and d["w"] * d["h"] < 0.35]
        if framed:
            return {**max(framed, key=lambda d: d["confidence"]), "faces": len(people), "how": "edges+faces"}
        return {**box, "confidence": 5.0, "faces": len(people), "how": "faces"}
    if not found:
        return None
    # A box with a person in it beats a sharper box without one (minimaps and HUD panels have strong edges too).
    for d in found:
        d["skin"] = round(skin_share(frames, d), 3)
    people = [d for d in found if d["skin"] >= 0.03]
    return max(people or found, key=lambda d: d["confidence"] * (1 + 4 * d["skin"]))
