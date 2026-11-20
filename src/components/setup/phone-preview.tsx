"use client";

import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { censor, cssFont, usesCam, type Box, type Style } from "./style";

const BASE_W = 288; // sizes in a look are measured on a 288-px-wide phone
const SAMPLE = "oh my gosh chat this shit just came out how do y'all know how to play this game let's go".split(" ");

export type Part = "hook" | "cap" | "cam";

/** Part of the frame (fractions) that fills a w x h box, like the engine's crop. */
function crop(frame: string, r: Box, w: number, h: number): CSSProperties {
  const S = Math.max(w / r.w, h / ((r.h * 9) / 16));
  return {
    backgroundImage: `url(${frame})`,
    backgroundSize: `${S}px auto`,
    backgroundPosition: `${-(r.x * S) - (r.w * S - w) / 2}px ${-((r.y * S * 9) / 16) - ((r.h * S * 9) / 16 - h) / 2}px`,
    backgroundRepeat: "no-repeat",
  };
}

/** Which part of the gameplay a w x h area shows (full height, moved by focus). */
export function gameRect(s: Style, areaW: number, areaH: number): Box {
  let w = (0.5625 * areaW) / areaH;
  let h = 1;
  if (w > 1) {
    h = 1 / w;
    w = 1;
  }
  return { x: s.focus * (1 - w), y: (1 - h) / 2, w, h };
}

/** The share of the frame used as gameplay in the current layout (for the band on the frame). */
export function gameBand(s: Style): Box {
  const split = (s.layout === "top" || s.layout === "bottom") && usesCam(s);
  const used = split ? (s.camPct + (s.gap || 0)) / 100 : 0;
  return gameRect(s, BASE_W, 512 * (1 - used));
}

type Props = {
  style: Style;
  frame: string | null;
  cam: Box | null;
  hook: string;
  /** Phone width in px (height follows 9:16). */
  width?: number;
  selected?: Part | null;
  onSelect?: (p: Part) => void;
  onCaptionY?: (y: number) => void;
  onHookY?: (y: number) => void;
};

/** Live phone-sized preview of a short with the chosen look, drawn from one frame of the video. */
export function PhonePreview({ style: s, frame, cam, hook, width = BASE_W, selected, onSelect, onCaptionY, onHookY }: Props) {
  const PW = width;
  const PH = Math.round((width * 16) / 9);
  const k = width / BASE_W;
  const [tick, setTick] = useState(0);
  const [phone, setPhone] = useState<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ part: Part; moved: boolean } | null>(null);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 450);
    return () => window.clearInterval(t);
  }, []);

  const box = s.cam ?? cam;
  const lay = usesCam(s) && box ? s.layout : s.layout === "full" ? "full" : "game";
  const parts: { key: string; style: CSSProperties; className?: string }[] = [];
  let gapTop = 0;
  let gapH = 0;
  let camArea: { top: number; height: number } | null = null;
  if (frame) {
    if ((lay === "top" || lay === "bottom") && box) {
      const ch = Math.round((PH * s.camPct) / 100);
      gapH = s.gap >= 1 ? Math.round((PH * s.gap) / 100) : 0;
      const gh = PH - ch - gapH;
      const camTop = lay === "top" ? 0 : gh + gapH;
      gapTop = lay === "top" ? ch : gh;
      camArea = { top: camTop, height: ch };
      parts.push({ key: "cam", style: { position: "absolute", left: 0, right: 0, height: ch, top: camTop, ...crop(frame, box, PW, ch) } });
      parts.push({ key: "game", style: { position: "absolute", left: 0, right: 0, height: gh, top: lay === "top" ? ch + gapH : 0, ...crop(frame, gameRect(s, PW, gh), PW, gh) } });
      if (gapH) {
        const band: CSSProperties = { position: "absolute", left: 0, right: 0, top: gapTop, height: gapH };
        if (s.gapStyle === "blur") Object.assign(band, crop(frame, { x: 0, y: 0, w: 1, h: 1 }, PW, gapH), { filter: "blur(10px) brightness(0.6)" });
        else band.background = s.gapStyle === "color" ? s.gapColor : "#000";
        parts.push({ key: "gap", style: band });
      }
    } else if (lay === "full") {
      const fh = (PW * 9) / 16;
      parts.push({ key: "bg", style: { position: "absolute", inset: 0, filter: "blur(14px) brightness(0.85)", transform: "scale(1.15)", ...crop(frame, { x: 0, y: 0, w: 1, h: 1 }, PW, PH) } });
      parts.push({ key: "fg", style: { position: "absolute", left: 0, right: 0, height: fh, top: (PH - fh) / 2, ...crop(frame, { x: 0, y: 0, w: 1, h: 1 }, PW, fh) } });
    } else {
      parts.push({ key: "game", style: { position: "absolute", inset: 0, ...crop(frame, gameRect(s, PW, PH), PW, PH) } });
      if (lay === "pip" && box) {
        const w = (PW * s.pipSize) / 100;
        const h = (w * (box.h * 9)) / (box.w * 16);
        const m = 12 * k;
        const top = s.pipCorner[0] === "t" ? PH * 0.09 : PH - PH * 0.22 - h;
        camArea = { top, height: h };
        parts.push({
          key: "pip",
          className: "rounded-md border-2 border-white/90 shadow-[0_8px_24px_rgb(0_0_0/0.5)]",
          style: { position: "absolute", width: w, height: h, top, ...(s.pipCorner[1] === "l" ? { left: m } : { right: m }), ...crop(frame, box, w, h) },
        });
      }
    }
  }

  // Where the opening line sits (its centre), like the engine.
  const h = s.hook;
  const below = lay === "pip" && camArea && s.pipCorner[0] === "t" ? camArea.top + camArea.height + (PH * 70) / 1920 : null;
  const hookY = h.pos === "gap" ? (gapH ? gapTop + gapH / 2 : camArea && lay === "top" ? camArea.height : below ?? (lay === "full" ? PH * 0.245 : PH * 0.156)) : h.pos === "top" ? PH * 0.091 : (PH * h.y) / 100;
  const hookFaded = h.show === "start" && tick % 16 >= 12; // hint that it disappears after a few seconds

  const c = s.captions;
  const n = c.words;
  const start = (tick * n) % (SAMPLE.length - n);
  const words = SAMPLE.slice(start, start + n).map((w) => (c.censor ? censor(w) : w));
  const hi = tick % n;

  const outline = (px: number) => `-${px}px -${px}px 0 #000,${px}px -${px}px 0 #000,-${px}px ${px}px 0 #000,${px}px ${px}px 0 #000`;
  const editable = (p: Part) => !!onSelect || (p === "cap" && !!onCaptionY) || (p === "hook" && !!onHookY);
  const ring = (p: Part) =>
    cn(
      editable(p) && "cursor-pointer rounded-lg outline-2 outline-offset-4 outline-dashed outline-transparent hover:outline-white/50",
      selected === p && "outline-moment hover:outline-moment",
    );

  function moveTo(part: Part, clientY: number) {
    const r = phone?.getBoundingClientRect();
    if (!r) return;
    const y = ((clientY - r.top) / r.height) * 100;
    if (part === "cap" && onCaptionY) onCaptionY(Math.round(Math.max(15, Math.min(88, y - 2))));
    if (part === "hook" && onHookY) onHookY(Math.round(Math.max(5, Math.min(92, y))));
  }
  const handlers = (part: Part) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (!editable(part)) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ part, moved: false });
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (drag?.part !== part) return;
      if ((part === "cap" && onCaptionY) || (part === "hook" && onHookY)) {
        moveTo(part, e.clientY);
        if (!drag.moved) setDrag({ part, moved: true });
      }
    },
    onPointerUp: () => {
      if (drag && !drag.moved) onSelect?.(part);
      setDrag(null);
    },
  });

  return (
    <div
      ref={setPhone}
      style={{ width: PW, height: PH }}
      className="relative shrink-0 touch-none overflow-hidden rounded-[26px] border border-border-strong bg-black shadow-[0_30px_80px_rgb(0_0_0/0.55)] select-none"
      aria-label="Preview of a short"
    >
      {parts.map((p) => (
        <div key={p.key} className={p.className} style={p.style} />
      ))}
      {camArea && onSelect && (
        <button
          type="button"
          aria-label="Change the layout and facecam"
          onClick={() => onSelect("cam")}
          className={cn("absolute inset-x-0 outline-2 -outline-offset-4 outline-dashed outline-transparent hover:outline-white/50", selected === "cam" && "outline-moment hover:outline-moment")}
          style={{ top: camArea.top, height: camArea.height }}
        />
      )}
      {!frame && <p className="absolute inset-0 grid place-items-center text-[13px] text-muted-foreground">Reading the video…</p>}

      {h.on && hook.trim() && (
        <div
          {...handlers("hook")}
          role={onSelect ? "button" : undefined}
          tabIndex={onSelect ? 0 : undefined}
          aria-label={onSelect ? "Opening line: click to change, drag to move" : undefined}
          onKeyDown={(e) => e.key === "Enter" && onSelect?.("hook")}
          className={cn("absolute inset-x-5 -translate-y-1/2 text-center transition-opacity", ring("hook"), hookFaded && "opacity-30", drag?.part === "hook" && "opacity-100")}
          style={{ top: hookY, fontFamily: cssFont(h.font), fontSize: h.size * k, lineHeight: 1.45 }}
        >
          <span
            className="rounded-md px-2 py-0.5 [box-decoration-break:clone]"
            style={
              h.bg
                ? { background: `${h.bg}${Math.round(255 * (1 - h.op / 100)).toString(16).padStart(2, "0")}`, color: h.fg }
                : { color: h.fg, textShadow: outline(Math.max(1, Math.round(1.6 * k))) }
            }
          >
            {hook}
          </span>
        </div>
      )}

      {c.style !== "none" && (
        <div
          {...handlers("cap")}
          role={onSelect || onCaptionY ? "button" : undefined}
          tabIndex={onSelect || onCaptionY ? 0 : undefined}
          aria-label={onSelect || onCaptionY ? "Captions: click to change, drag to move" : undefined}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSelect?.("cap");
            if (onCaptionY && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
              e.preventDefault();
              onCaptionY(Math.max(15, Math.min(88, c.y + (e.key === "ArrowUp" ? -2 : 2))));
            }
          }}
          className={cn("absolute inset-x-3.5 text-center leading-[1.12]", ring("cap"), !editable("cap") && "pointer-events-none")}
          style={{
            top: `${c.y}%`,
            fontFamily: cssFont(c.font),
            fontSize: c.size * 0.8 * k * (c.style === "box" ? 0.72 : 1),
            color: c.color,
            textTransform: c.upper ? "uppercase" : "none",
            textShadow: c.outline ? `${outline(Math.round(2 * k))},0 3px 6px rgba(0,0,0,.6)` : "0 2px 6px rgba(0,0,0,.7)",
          }}
        >
          {c.style === "box" ? (
            <span className="rounded-md bg-black/60 px-2 py-0.5 [box-decoration-break:clone]">{words.join(" ")}</span>
          ) : (
            words.map((w, i) => (
              <Fragment key={i}>
                {i > 0 && " "}
                <span style={i === hi ? { color: c.hl, display: "inline-block", transform: "scale(1.08)" } : undefined}>{w}</span>
              </Fragment>
            ))
          )}
        </div>
      )}
      {s.progress && <div className="pointer-events-none absolute bottom-0 left-0 h-[5px] animate-[prog_8s_linear_infinite]" style={{ background: s.progressColor }} />}
      {s.flash && <div className="pointer-events-none absolute top-2.5 left-2.5 rounded-md bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">▶ Starts with the best 1.5 s</div>}
    </div>
  );
}
