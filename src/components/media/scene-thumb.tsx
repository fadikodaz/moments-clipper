import type { SceneKind } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

/**
 * Placeholder artwork drawn as SVG from a seed. The real product shows FFmpeg-extracted
 * frames here, so this component is meant to be replaced by an <Image> later.
 */

type Palette = { sky: [string, string]; build: string; lit: string[]; road: string; car: string };

const PALETTES: Record<SceneKind, Palette> = {
  chase: { sky: ["#1b1838", "#2c2350"], build: "#151428", lit: ["#2ec4d6", "#5fd4e0", "#c9a74a"], road: "#24223a", car: "#e85a9a" },
  stunt: { sky: ["#3a2244", "#c06a4a"], build: "#1d1526", lit: ["#f0b860", "#e8945a"], road: "#2a2030", car: "#f2c14e" },
  funny: { sky: ["#6f8fb0", "#a9c1d6"], build: "#4d6178", lit: ["#cfd9e2", "#9fb3c6"], road: "#3e4652", car: "#f2c14e" },
  scenic: { sky: ["#e08a5a", "#f3c27a"], build: "#5a3a3a", lit: ["#ffd48a"], road: "#4a3434", car: "#3b82c4" },
  action: { sky: ["#2a1a22", "#6a2a2a"], build: "#1a1216", lit: ["#ff8a5a", "#ffc37a"], road: "#2a1e22", car: "#d6d6d6" },
  podcast: { sky: ["#17181c", "#24262c"], build: "#1d1f24", lit: ["#60a5fa"], road: "#141518", car: "#60a5fa" },
};

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return (s % 100000) / 100000;
  };
}

export function SceneThumb({
  kind,
  seed,
  orientation = "wide",
  className,
}: {
  kind: SceneKind;
  seed: number;
  orientation?: "wide" | "vertical";
  className?: string;
}) {
  const p = PALETTES[kind];
  const r = rng(seed * 7919 + 17);
  const W = orientation === "wide" ? 320 : 90;
  const H = orientation === "wide" ? 180 : 160;
  const horizon = H * (orientation === "wide" ? 0.62 : 0.6);
  const id = `st-${kind}-${seed}-${orientation}`;

  const buildings: { x: number; w: number; h: number }[] = [];
  for (let x = -4; x < W; ) {
    const w = (orientation === "wide" ? 18 : 10) + r() * (orientation === "wide" ? 30 : 16);
    const h = horizon * (0.25 + r() * 0.65);
    buildings.push({ x, w, h });
    x += w + 2 + r() * 4;
  }

  const win = orientation === "wide" ? 3 : 2.4;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className={cn("block h-full w-full", className)} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.sky[0]} />
          <stop offset="1" stopColor={p.sky[1]} />
        </linearGradient>
        <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.45" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id}-sky)`} />
      {kind === "scenic" && <circle cx={W * 0.7} cy={horizon * 0.62} r={W * 0.07} fill="#ffe2a8" opacity="0.85" />}
      {buildings.map((b, i) => {
        const top = horizon - b.h;
        const cols = Math.max(1, Math.floor((b.w - 4) / (win * 2.2)));
        const rows = Math.max(1, Math.floor((b.h - 6) / (win * 2.6)));
        const lights = [];
        for (let cy = 0; cy < rows; cy++) {
          for (let cx = 0; cx < cols; cx++) {
            if (r() < 0.42) {
              lights.push(
                <rect key={`${cx}-${cy}`} x={b.x + 3 + cx * win * 2.2} y={top + 4 + cy * win * 2.6} width={win} height={win} fill={p.lit[Math.floor(r() * p.lit.length)]} opacity={0.6 + r() * 0.4} />,
              );
            }
          }
        }
        return (
          <g key={i}>
            <rect x={b.x} y={top} width={b.w} height={b.h + 1} fill={p.build} />
            {lights}
          </g>
        );
      })}
      <path d={`M0 ${H} L${W * 0.42} ${horizon} L${W * 0.58} ${horizon} L${W} ${H} Z`} fill={p.road} />
      <rect x={0} y={horizon} width={W} height={H - horizon} fill={p.road} opacity="0.55" />
      {[0.15, 0.35, 0.6].map((t, i) => (
        <rect key={i} x={W / 2 - 1 - t * 1.5} y={horizon + (H - horizon) * t} width={2 + t * 3} height={(H - horizon) * 0.1} fill="#e8e8e8" opacity="0.5" />
      ))}
      {kind !== "podcast" && (
        <g transform={`translate(${W * (0.42 + r() * 0.12)} ${horizon + (H - horizon) * 0.5})`}>
          <rect width={W * 0.14} height={W * (orientation === "wide" ? 0.04 : 0.09)} rx="1.5" fill={p.car} />
          <rect x={W * 0.03} y={-W * (orientation === "wide" ? 0.02 : 0.04)} width={W * 0.08} height={W * (orientation === "wide" ? 0.025 : 0.05)} rx="1" fill={p.car} opacity="0.75" />
        </g>
      )}
      <rect width={W} height={H} fill={`url(#${id}-shade)`} />
    </svg>
  );
}
