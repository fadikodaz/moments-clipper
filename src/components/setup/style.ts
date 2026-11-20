/** The look of a short. Same shape and defaults as engine/style.py, which checks every value again. */
export type Box = { x: number; y: number; w: number; h: number };
export type Layout = "top" | "bottom" | "pip" | "game" | "full";
export type Style = {
  layout: Layout;
  cam: Box | null;
  nocam: boolean;
  camPct: number;
  focus: number;
  pipCorner: "tl" | "tr" | "bl" | "br";
  pipSize: number;
  captions: { style: "word" | "box" | "none"; font: FontKey; size: number; color: string; hl: string; y: number; upper: boolean; words: number; outline: boolean; censor: boolean };
  /** Opening line. bg null = no box (outlined text); op = box see-through %; size in preview px (288 wide);
   *  show "start" (first sec seconds) or "all"; pos "gap" (between facecam and gameplay), "top" or "custom" (y %). */
  hook: { on: boolean; style: HookPreset; sec: number; font: FontKey; fg: string; bg: string | null; op: number; size: number; show: "start" | "all"; pos: "gap" | "top" | "custom"; y: number };
  /** Space between facecam and gameplay, % of the height (cam top/bottom layouts). */
  gap: number;
  gapStyle: "black" | "blur" | "color";
  gapColor: string;
  flash: boolean;
  zoom: boolean;
  progress: boolean;
  progressColor: string;
};

export const FONTS = [
  ["Montserrat", "Montserrat Black", "Montserrat Black"],
  ["Anton", "Anton", "Anton"],
  ["Bebas Neue", "Bebas Neue", "Bebas Neue"],
  ["Poppins", "Poppins ExtraBold", "Poppins ExtraBold"],
  ["Arial Black", "Arial Black", "Arial Black"],
] as const;
export type FontKey = (typeof FONTS)[number][0];
/** CSS font-family for the preview (loaded from /fonts in globals.css). */
export const cssFont = (k: FontKey) => `"${FONTS.find((f) => f[0] === k)?.[2] ?? "Arial Black"}", "Arial Black", sans-serif`;

export const LAYOUTS: [Layout, string][] = [
  ["top", "Cam top,\ngame below"],
  ["bottom", "Game top,\ncam below"],
  ["pip", "Small cam\nin a corner"],
  ["game", "Gameplay\nonly"],
  ["full", "Whole screen,\nblurred edges"],
];

export const DEFAULT_STYLE: Style = {
  layout: "top",
  cam: null,
  nocam: false,
  camPct: 36,
  focus: 0.5,
  pipCorner: "tr",
  pipSize: 38,
  captions: { style: "word", font: "Montserrat", size: 26, color: "#ffffff", hl: "#ffd23f", y: 62, upper: true, words: 3, outline: true, censor: true },
  hook: { on: true, style: "white", sec: 3, font: "Montserrat", fg: "#000000", bg: "#ffffff", op: 0, size: 17, show: "start", pos: "gap", y: 34 },
  gap: 7,
  gapStyle: "black",
  gapColor: "#ff7448",
  flash: true,
  zoom: true,
  progress: true,
  progressColor: "#ff7448",
};

/** Fill in anything missing (older presets, older shorts). */
export function withDefaults(raw: unknown): Style {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Style>;
  const h = (r.hook ?? {}) as Partial<Style["hook"]>;
  // Older looks only named a hook style: turn it into colours.
  const legacy = HOOK_PRESETS.find(([k]) => k === h.style) ?? (h.style === "plain" ? HOOK_PRESETS[3] : null);
  const colours = legacy && h.fg === undefined ? { fg: legacy[2], bg: legacy[3] } : {};
  return {
    ...DEFAULT_STYLE,
    ...r,
    gap: r.gap ?? (raw && typeof raw === "object" && "gap" in raw ? DEFAULT_STYLE.gap : 0),
    captions: { ...DEFAULT_STYLE.captions, ...(r.captions ?? {}) },
    hook: { ...DEFAULT_STYLE.hook, ...h, ...colours },
  };
}

export type HookPreset = "white" | "yellow" | "black" | "outline" | "red" | "plain" | "custom";
export const HOOK_PRESETS: [HookPreset, string, string, string | null][] = [
  ["white", "White box", "#000000", "#ffffff"],
  ["yellow", "Yellow box", "#000000", "#ffd23f"],
  ["black", "Black box", "#ffffff", "#111111"],
  ["outline", "Outline", "#ffffff", null],
  ["red", "Red box", "#ffffff", "#e53935"],
];

export type CaptionPreset = "bold" | "clean" | "boxed" | "punch" | "none";
export const CAPTION_PRESETS: [CaptionPreset, string, Partial<Style["captions"]>][] = [
  ["bold", "Bold yellow", { style: "word", font: "Montserrat", color: "#ffffff", hl: "#ffd23f", upper: true, outline: true }],
  ["clean", "Clean white", { style: "word", font: "Poppins", color: "#ffffff", hl: "#ffffff", upper: false, outline: true }],
  ["boxed", "Boxed", { style: "box", font: "Poppins", color: "#ffffff", hl: "#ffffff", upper: false, outline: false }],
  ["punch", "Big punch", { style: "word", font: "Anton", color: "#ffffff", hl: "#ff4d4d", upper: true, outline: true }],
  ["none", "No captions", { style: "none" }],
];
export function captionPreset(c: Style["captions"]): CaptionPreset | null {
  if (c.style === "none") return "none";
  const hit = CAPTION_PRESETS.find(([, , p]) => Object.entries(p).every(([k, v]) => c[k as keyof Style["captions"]] === v));
  return hit ? hit[0] : null;
}

export const usesCam = (s: Style) => !s.nocam && (s.layout === "top" || s.layout === "bottom" || s.layout === "pip");

const SWEARS = /\b(f+u+c*k+\w*|motherf\w*|sh+i+t+\w*|bitch\w*|bullshit|asshole\w*|dick\w*|pussy\w*|cunt\w*)\b/gi;
export const censor = (t: string) => t.replace(SWEARS, (w) => w[0] + "*".repeat(Math.min(3, w.length - 1)));
