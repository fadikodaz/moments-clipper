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
  hook: { on: boolean; style: "white" | "yellow" | "plain"; sec: number };
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
  hook: { on: true, style: "white", sec: 3 },
  flash: true,
  zoom: true,
  progress: true,
  progressColor: "#ff7448",
};

/** Fill in anything missing (older presets, older shorts). */
export function withDefaults(raw: unknown): Style {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Style>;
  return {
    ...DEFAULT_STYLE,
    ...r,
    captions: { ...DEFAULT_STYLE.captions, ...(r.captions ?? {}) },
    hook: { ...DEFAULT_STYLE.hook, ...(r.hook ?? {}) },
  };
}

export const usesCam = (s: Style) => !s.nocam && (s.layout === "top" || s.layout === "bottom" || s.layout === "pip");

const SWEARS = /\b(f+u+c*k+\w*|motherf\w*|sh+i+t+\w*|bitch\w*|bullshit|asshole\w*|dick\w*|pussy\w*|cunt\w*)\b/gi;
export const censor = (t: string) => t.replace(SWEARS, (w) => w[0] + "*".repeat(Math.min(3, w.length - 1)));
