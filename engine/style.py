"""
How a short looks: layout, facecam box, captions, opening line and extras.
Chosen on the website's "Set up your shorts" screen (and in the Edit tab), stored as JSON.
Every value is checked here, so the rest of the engine can trust it.
"""

import re

FONTS = {  # what the website calls it -> font family name inside the file (engine/fonts) or Windows
    "Montserrat": "Montserrat Black",
    "Anton": "Anton",
    "Bebas Neue": "Bebas Neue",
    "Poppins": "Poppins ExtraBold",
    "Arial Black": "Arial Black",
}
LAYOUTS = ("top", "bottom", "pip", "game", "full")

DEFAULT = {
    "layout": "top",        # top: cam above game, bottom: game above cam, pip: small cam in a corner, game: gameplay only, full: whole frame + blur
    "cam": None,            # facecam box chosen by the user {x,y,w,h} as fractions; None = use the detected one
    "nocam": False,
    "camPct": 36,           # share of the short's height the facecam takes (top/bottom)
    "focus": 0.5,           # which part of the gameplay is shown: 0 left, 0.5 middle, 1 right
    "pipCorner": "tr",
    "pipSize": 38,          # facecam width as % of the short's width (pip)
    "captions": {"style": "word", "font": "Montserrat", "size": 26, "color": "#ffffff", "hl": "#ffd23f",
                 "y": 62, "upper": True, "words": 3, "outline": True, "censor": True},
    "hook": {"on": True, "style": "white", "sec": 3},
    "flash": True,          # start with 1.5 s of the biggest moment, then the story
    "zoom": True,           # quick push-in on the facecam at the loudest seconds
    "progress": True,
    "progressColor": "#ff7448",
}


def _num(v, lo, hi, default):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return default


def _color(v, default):
    return v if isinstance(v, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", v) else default


def _box(v):
    if not isinstance(v, dict):
        return None
    try:
        b = {k: float(v[k]) for k in ("x", "y", "w", "h")}
    except (KeyError, TypeError, ValueError):
        return None
    if not (0 <= b["x"] < 1 and 0 <= b["y"] < 1 and 0.03 <= b["w"] <= 1 and 0.03 <= b["h"] <= 1):
        return None
    b["w"], b["h"] = min(b["w"], 1 - b["x"]), min(b["h"], 1 - b["y"])
    return b


def normalize(raw: dict | None, layout: str = "auto", captions: str = "bold") -> dict:
    """A complete, safe style. Without one, the old layout/captions options are translated."""
    d = DEFAULT
    if not isinstance(raw, dict):
        raw = {"layout": "game" if layout == "none" else "top",
               "captions": {"style": {"bold": "word", "simple": "box", "none": "none"}.get(captions, "word")},
               "flash": False, "zoom": False, "progress": False, "hook": {"on": True, "style": "white", "sec": 3.5},
               "_legacy": True}
    c, h = raw.get("captions") or {}, raw.get("hook") or {}
    dc, dh = d["captions"], d["hook"]
    out = {
        "layout": raw.get("layout") if raw.get("layout") in LAYOUTS else d["layout"],
        "cam": _box(raw.get("cam")),
        "nocam": bool(raw.get("nocam", False)),
        "camPct": _num(raw.get("camPct"), 20, 55, d["camPct"]),
        "focus": _num(raw.get("focus"), 0, 1, d["focus"]),
        "pipCorner": raw.get("pipCorner") if raw.get("pipCorner") in ("tl", "tr", "bl", "br") else d["pipCorner"],
        "pipSize": _num(raw.get("pipSize"), 20, 65, d["pipSize"]),
        "captions": {
            "style": c.get("style") if c.get("style") in ("word", "box", "none") else dc["style"],
            "font": c.get("font") if c.get("font") in FONTS else dc["font"],
            "size": _num(c.get("size"), 14, 48, dc["size"]),
            "color": _color(c.get("color"), dc["color"]),
            "hl": _color(c.get("hl"), dc["hl"]),
            "y": _num(c.get("y"), 15, 88, dc["y"]),
            "upper": bool(c.get("upper", dc["upper"])),
            "words": int(_num(c.get("words"), 1, 6, dc["words"])),
            "outline": bool(c.get("outline", dc["outline"])),
            "censor": bool(c.get("censor", dc["censor"])),
        },
        "hook": {
            "on": bool(h.get("on", dh["on"])),
            "style": h.get("style") if h.get("style") in ("white", "yellow", "plain") else dh["style"],
            "sec": _num(h.get("sec"), 1.5, 8, dh["sec"]),
        },
        "flash": bool(raw.get("flash", d["flash"])),
        "zoom": bool(raw.get("zoom", d["zoom"])),
        "progress": bool(raw.get("progress", d["progress"])),
        "progressColor": _color(raw.get("progressColor"), d["progressColor"]),
    }
    if raw.get("_legacy"):  # projects made before styles keep their old look
        out["captions"].update({"font": "Arial Black", "size": 25, "hl": "#ff7448", "y": 68, "words": 4, "censor": False})
    if out["nocam"] and out["layout"] in ("top", "bottom", "pip"):
        out["layout"] = "game"
    return out


SWEARS = re.compile(r"\b(f+u+c*k+\w*|motherf\w*|sh+i+t+\w*|bitch\w*|bullshit|asshole\w*|dick\w*|pussy\w*|n+i+g+g+\w*|cunt\w*)\b", re.I)


def censor(text: str) -> str:
    """f*** style: first letter stays, so viewers still get it."""
    return SWEARS.sub(lambda m: m.group(0)[0] + "*" * min(3, len(m.group(0)) - 1), text)


def ass_color(hex_color: str, alpha: int = 0) -> str:
    """#RRGGBB -> &HAABBGGRR (ASS colour order)."""
    r, g, b = hex_color[1:3], hex_color[3:5], hex_color[5:7]
    return f"&H{alpha:02X}{b}{g}{r}".upper()
