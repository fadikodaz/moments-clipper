"use client";

import { useRef, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { btn, btnGhost, btnSm } from "@/components/kit";
import { cn } from "@/lib/utils";
import { gameBand } from "./phone-preview";
import { usesCam, type Box, type Style } from "./style";

type Props = {
  frames: { url: string; t: number }[];
  index: number;
  onIndex: (i: number) => void;
  detected: Box | null;
  style: Style;
  set: (fn: (s: Style) => Style) => void;
};

export const DEFAULT_BOX: Box = { x: 0.02, y: 0.58, w: 0.32, h: 0.4 };

/** One real frame of the video with the facecam box: drag it to move, drag a corner to resize. */
export function FrameEditor({ frames, index, onIndex, detected, style: s, set }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ h: string; x: number; y: number; start: Box; w: number; hgt: number } | null>(null);
  const box = s.cam ?? detected;
  const showBox = !s.nocam && box;
  const band = gameBand(s);

  function down(e: React.PointerEvent) {
    const target = e.target as HTMLElement;
    if (!box || !target.closest("[data-box]")) return;
    const r = ref.current!.getBoundingClientRect();
    setDrag({ h: target.dataset.h ?? "move", x: e.clientX, y: e.clientY, start: box, w: r.width, hgt: r.height });
    ref.current!.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / drag.w;
    const dy = (e.clientY - drag.y) / drag.hgt;
    const c = { ...drag.start };
    if (drag.h === "move") {
      c.x += dx;
      c.y += dy;
    }
    if (drag.h.includes("w")) {
      c.x += dx;
      c.w -= dx;
    }
    if (drag.h.includes("e")) c.w += dx;
    if (drag.h.includes("n")) {
      c.y += dy;
      c.h -= dy;
    }
    if (drag.h.includes("s")) c.h += dy;
    c.w = Math.max(0.06, Math.min(1, c.w));
    c.h = Math.max(0.08, Math.min(1, c.h));
    c.x = Math.max(0, Math.min(1 - c.w, c.x));
    c.y = Math.max(0, Math.min(1 - c.h, c.y));
    set((x) => ({ ...x, cam: c }));
  }

  const handle = "absolute size-3.5 rounded-[4px] border-2 border-white bg-moment";
  const frame = frames[index]?.url;

  return (
    <>
      <div
        ref={ref}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => setDrag(null)}
        className="relative aspect-video touch-none overflow-hidden rounded-xl bg-black bg-cover bg-center select-none"
        style={frame ? { backgroundImage: `url(${frame})` } : undefined}
      >
        {s.layout !== "full" && (
          <div className="pointer-events-none absolute inset-y-0 border-x border-dashed border-white/55 bg-white/5" style={{ left: `${band.x * 100}%`, width: `${band.w * 100}%` }}>
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] whitespace-nowrap text-white">Gameplay used in the short</span>
          </div>
        )}
        {showBox && (
          <div
            data-box
            className="absolute cursor-move rounded border-2 border-moment shadow-[0_0_0_9999px_rgb(0_0_0/0.45)]"
            style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
          >
            <span className="absolute -top-[26px] -left-0.5 rounded-t-md rounded-br-md bg-moment px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-moment-ink">Facecam</span>
            <i data-box data-h="nw" className={cn(handle, "-top-2 -left-2 cursor-nwse-resize")} />
            <i data-box data-h="ne" className={cn(handle, "-top-2 -right-2 cursor-nesw-resize")} />
            <i data-box data-h="sw" className={cn(handle, "-bottom-2 -left-2 cursor-nesw-resize")} />
            <i data-box data-h="se" className={cn(handle, "-right-2 -bottom-2 cursor-nwse-resize")} />
          </div>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {frames.map((f, i) => (
          <button
            key={f.url}
            type="button"
            aria-pressed={i === index}
            aria-label={`Frame ${i + 1}`}
            onClick={() => onIndex(i)}
            className={cn("aspect-video w-[82px] rounded-lg border-2 border-transparent bg-cover bg-center", i === index && "border-foreground")}
            style={{ backgroundImage: `url(${f.url})` }}
          />
        ))}
        <span className="flex-1" />
        {!s.nocam && (
          <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", s.cam ? "text-muted-foreground" : detected ? "text-good" : "text-muted-foreground")}>
            {s.cam ? <Pencil className="size-3.5" aria-hidden="true" /> : detected ? <Check className="size-3.5" aria-hidden="true" /> : null}
            {s.cam ? "Placed by you" : detected ? "Found automatically" : "No facecam found: place the box yourself"}
          </span>
        )}
        {s.cam && (
          <button type="button" onClick={() => set((x) => ({ ...x, cam: null }))} className={cn(btn, btnSm, btnGhost)}>
            Reset
          </button>
        )}
        {s.nocam || !box ? (
          <button type="button" onClick={() => set((x) => ({ ...x, nocam: false, cam: x.cam ?? detected ?? DEFAULT_BOX, layout: usesCam({ ...x, nocam: false }) ? x.layout : "top" }))} className={cn(btn, btnSm)}>
            {s.nocam ? "Use a facecam" : "Place a facecam box"}
          </button>
        ) : (
          <button type="button" onClick={() => set((x) => ({ ...x, nocam: true, layout: usesCam({ ...x, nocam: false }) ? "game" : x.layout }))} className={cn(btn, btnSm)}>
            No facecam
          </button>
        )}
      </div>
    </>
  );
}
