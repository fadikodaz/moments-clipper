"use client";

import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { censor, cssFont, usesCam, type Box, type Style } from "./style";

const PW = 288;
const PH = 512;
const SAMPLE = "oh my gosh chat this shit just came out how do y'all know how to play this game let's go".split(" ");

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
export function gameRect(s: Style, areaW = PW, areaH = PH): Box {
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
  const camShare = (s.layout === "top" || s.layout === "bottom") && usesCam(s) ? s.camPct / 100 : 0;
  return gameRect(s, PW, PH * (1 - camShare));
}

/** Live phone-sized preview of a short with the chosen look, drawn from one frame of the video. */
export function PhonePreview({ style: s, frame, cam, hook }: { style: Style; frame: string | null; cam: Box | null; hook: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 450);
    return () => window.clearInterval(t);
  }, []);

  const box = s.cam ?? cam;
  const lay = usesCam(s) && box ? s.layout : s.layout === "full" ? "full" : "game";
  const parts: { key: string; style: CSSProperties; className?: string }[] = [];
  let seam = 0;
  if (frame) {
    if ((lay === "top" || lay === "bottom") && box) {
      const ch = Math.round((PH * s.camPct) / 100);
      const gh = PH - ch;
      parts.push({ key: "cam", style: { position: "absolute", left: 0, right: 0, height: ch, top: lay === "top" ? 0 : gh, ...crop(frame, box, PW, ch) } });
      parts.push({ key: "game", style: { position: "absolute", left: 0, right: 0, height: gh, top: lay === "top" ? ch : 0, ...crop(frame, gameRect(s, PW, gh), PW, gh) } });
      seam = lay === "top" ? ch : 0;
    } else if (lay === "full") {
      const fh = (PW * 9) / 16;
      parts.push({ key: "bg", style: { position: "absolute", inset: 0, filter: "blur(14px) brightness(0.85)", transform: "scale(1.15)", ...crop(frame, { x: 0, y: 0, w: 1, h: 1 }, PW, PH) } });
      parts.push({ key: "fg", style: { position: "absolute", left: 0, right: 0, height: fh, top: (PH - fh) / 2, ...crop(frame, { x: 0, y: 0, w: 1, h: 1 }, PW, fh) } });
    } else {
      parts.push({ key: "game", style: { position: "absolute", inset: 0, ...crop(frame, gameRect(s, PW, PH), PW, PH) } });
      if (lay === "pip" && box) {
        const w = (PW * s.pipSize) / 100;
        const h = (w * (box.h * 9)) / (box.w * 16);
        const m = 12;
        parts.push({
          key: "pip",
          className: "rounded-md border-2 border-white/90 shadow-[0_8px_24px_rgb(0_0_0/0.5)]",
          style: {
            position: "absolute",
            width: w,
            height: h,
            ...(s.pipCorner[0] === "t" ? { top: PH * 0.09 } : { bottom: PH * 0.22 }),
            ...(s.pipCorner[1] === "l" ? { left: m } : { right: m }),
            ...crop(frame, box, w, h),
          },
        });
      }
    }
  }

  const c = s.captions;
  const n = c.words;
  const start = (tick * n) % (SAMPLE.length - n);
  const words = SAMPLE.slice(start, start + n).map((w) => (c.censor ? censor(w) : w));
  const k = tick % n;
  const hookTop = seam ? seam - 14 : lay === "full" ? 100 : lay === "bottom" ? 50 : 70;
  const hookLook: Record<Style["hook"]["style"], CSSProperties> = {
    white: { background: "#fff", color: "#000" },
    yellow: { background: "#ffd23f", color: "#000" },
    plain: { color: "#fff", textShadow: "0 2px 0 #000, 0 0 6px #000" },
  };

  return (
    <div className="relative h-[512px] w-[288px] shrink-0 overflow-hidden rounded-[26px] border border-border-strong bg-black shadow-[0_30px_80px_rgb(0_0_0/0.55)]" aria-label="Preview of a short">
      {parts.map((p) => (
        <div key={p.key} className={p.className} style={p.style} />
      ))}
      {!frame && <p className="absolute inset-0 grid place-items-center text-[13px] text-muted-foreground">Reading the video…</p>}
      {s.hook.on && hook.trim() && (
        <div className="pointer-events-none absolute inset-x-6 text-center text-[15px] leading-[1.25]" style={{ top: hookTop, fontFamily: cssFont("Montserrat") }}>
          <span className="rounded-md px-2 py-1 [box-decoration-break:clone]" style={hookLook[s.hook.style]}>
            {hook}
          </span>
        </div>
      )}
      {c.style !== "none" && (
        <div
          className="pointer-events-none absolute inset-x-3.5 text-center leading-[1.12]"
          style={{
            top: `${c.y}%`,
            fontFamily: cssFont(c.font),
            fontSize: c.size * 0.8 * (c.style === "box" ? 0.72 : 1),
            color: c.color,
            textTransform: c.upper ? "uppercase" : "none",
            textShadow: c.outline ? "-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,2px 2px 0 #000,0 3px 6px rgba(0,0,0,.6)" : "0 2px 6px rgba(0,0,0,.7)",
          }}
        >
          {c.style === "box" ? (
            <span className="rounded-md bg-black/60 px-2 py-0.5 [box-decoration-break:clone]">{words.join(" ")}</span>
          ) : (
            words.map((w, i) => (
              <Fragment key={i}>
                {i > 0 && " "}
                <span style={i === k ? { color: c.hl, display: "inline-block", transform: "scale(1.08)" } : undefined}>{w}</span>
              </Fragment>
            ))
          )}
        </div>
      )}
      {s.progress && <div className="absolute bottom-0 left-0 h-[5px] animate-[prog_8s_linear_infinite]" style={{ background: s.progressColor }} />}
      {s.flash && <div className="absolute top-2.5 left-2.5 rounded-md bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">▶ Starts with the best 1.5 s</div>}
    </div>
  );
}
