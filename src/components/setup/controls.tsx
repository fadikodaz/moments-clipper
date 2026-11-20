"use client";

import { useId, type ReactNode } from "react";
import { field } from "@/components/kit";
import { cn } from "@/lib/utils";
import { FONTS, LAYOUTS, type Layout, type Style } from "./style";

export function Card({ n, title, sub, children, className }: { n?: number; title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border bg-panel p-4", className)}>
      <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold">
        {n !== undefined && <span className="grid size-[22px] place-items-center rounded-full bg-raised font-mono text-xs font-semibold text-muted-foreground">{n}</span>}
        {title}
      </h2>
      {sub && <p className="mb-3.5 text-[13px] text-muted-foreground">{sub}</p>}
      {children}
    </section>
  );
}

export function Switch({ label, hint, on, onChange, disabled }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3.5 gap-y-0.5 border-t py-2.5 first:border-t-0">
      <b className="font-semibold">{label}</b>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={cn(
          "relative row-span-2 h-6 w-10 rounded-full bg-hover transition-colors disabled:cursor-not-allowed disabled:opacity-35",
          "after:absolute after:top-[3px] after:left-[3px] after:size-[18px] after:rounded-full after:bg-muted-foreground after:transition-[left]",
          on && "bg-moment after:left-[19px] after:bg-white",
        )}
      />
      {hint && <small className="text-xs text-muted-foreground">{hint}</small>}
    </div>
  );
}

export function Range({ label, value, shown, min, max, step = 1, onChange }: { label: string; value: number; shown?: string; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="grid gap-1.5">
      <span className="flex justify-between text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <b className="font-mono text-xs text-foreground">{shown ?? value}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-moment" />
    </label>
  );
}

export function Pick<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className={field}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-[38px] w-full cursor-pointer rounded-[10px] border bg-panel p-[3px]" />
    </label>
  );
}

function LayoutIcon({ k }: { k: Layout }) {
  const cam = "#ff7448", game = "#5b6070";
  const r = (x: number, y: number, w: number, h: number, f: string) => <rect x={x} y={y} width={w} height={h} rx={2} fill={f} />;
  return (
    <svg viewBox="0 0 30 52" className="h-[52px] w-[30px]" aria-hidden="true">
      {k === "top" && <>{r(1, 1, 28, 18, cam)}{r(1, 20, 28, 31, game)}</>}
      {k === "bottom" && <>{r(1, 1, 28, 31, game)}{r(1, 33, 28, 18, cam)}</>}
      {k === "pip" && <>{r(1, 1, 28, 50, game)}{r(17, 4, 10, 9, cam)}</>}
      {k === "game" && r(1, 1, 28, 50, game)}
      {k === "full" && <>{r(1, 1, 28, 50, "#3a3d44")}{r(1, 18, 28, 16, game)}</>}
    </svg>
  );
}

type Set = (fn: (s: Style) => Style) => void;

export function LayoutControls({ style: s, set, hasCam }: { style: Style; set: Set; hasCam: boolean }) {
  const focus = s.focus < 0.4 ? "Left" : s.focus > 0.6 ? "Right" : "Middle";
  return (
    <>
      <div role="group" aria-label="Layout" className="mb-3.5 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {LAYOUTS.map(([k, label]) => {
          const needsCam = k === "top" || k === "bottom" || k === "pip";
          return (
            <button
              key={k}
              type="button"
              aria-pressed={s.layout === k}
              disabled={needsCam && !hasCam}
              title={needsCam && !hasCam ? "Mark the facecam first" : undefined}
              onClick={() => set((x) => ({ ...x, layout: k, nocam: needsCam ? false : x.nocam }))}
              className={cn(
                "grid justify-items-center gap-[7px] rounded-xl border bg-raised px-1.5 py-2.5 text-center text-xs leading-tight font-medium whitespace-pre-line text-muted-foreground disabled:opacity-35",
                s.layout === k && "border-moment bg-moment-soft text-foreground",
              )}
            >
              <LayoutIcon k={k} />
              {label}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
        {(s.layout === "top" || s.layout === "bottom") && (
          <Range label="Facecam size" value={s.camPct} shown={`${s.camPct}% of height`} min={22} max={50} onChange={(v) => set((x) => ({ ...x, camPct: v }))} />
        )}
        {s.layout === "pip" && (
          <>
            <Pick
              label="Corner"
              value={s.pipCorner}
              options={[["tl", "Top left"], ["tr", "Top right"], ["bl", "Bottom left"], ["br", "Bottom right"]]}
              onChange={(v) => set((x) => ({ ...x, pipCorner: v }))}
            />
            <Range label="Facecam size" value={s.pipSize} shown={`${s.pipSize}% of width`} min={25} max={60} onChange={(v) => set((x) => ({ ...x, pipSize: v }))} />
          </>
        )}
        {s.layout !== "full" ? (
          <Range label="Gameplay part" value={Math.round(s.focus * 100)} shown={focus} min={0} max={100} onChange={(v) => set((x) => ({ ...x, focus: v / 100 }))} />
        ) : (
          <p className="col-span-full text-[13px] text-muted-foreground">Shows the whole stream picture, including the facecam, with a blurred copy filling the top and bottom.</p>
        )}
      </div>
    </>
  );
}

export function CaptionControls({ style: s, set }: { style: Style; set: Set }) {
  const c = s.captions;
  const cap = (patch: Partial<Style["captions"]>) => set((x) => ({ ...x, captions: { ...x.captions, ...patch } }));
  const id = useId();
  return (
    <>
      <div role="group" aria-label="Caption style" className="mb-3.5 inline-flex flex-wrap gap-0.5 rounded-[11px] border bg-panel p-[3px]">
        {(
          [
            ["word", "Word by word"],
            ["box", "Simple lines"],
            ["none", "No captions"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={c.style === k} onClick={() => cap({ style: k })} className={cn("h-8 rounded-lg px-3 text-[13px] font-medium text-muted-foreground", c.style === k && "bg-raised text-foreground shadow-[0_0_0_1px_var(--border-strong)]")}>
            {l}
          </button>
        ))}
      </div>
      <div className={cn("grid grid-cols-2 gap-3.5 sm:grid-cols-3", c.style === "none" && "pointer-events-none opacity-40")} id={id}>
        <Pick label="Font" value={c.font} options={FONTS.map(([k, l]) => [k, l])} onChange={(v) => cap({ font: v })} />
        <Color label="Text colour" value={c.color} onChange={(v) => cap({ color: v })} />
        <Color label="Spoken word colour" value={c.hl} onChange={(v) => cap({ hl: v })} />
        <Range label="Size" value={c.size} min={16} max={44} onChange={(v) => cap({ size: v })} />
        <Range label="Height on screen" value={c.y} shown={`${c.y}%`} min={20} max={85} onChange={(v) => cap({ y: v })} />
        <Range label="Words at a time" value={c.words} min={1} max={6} onChange={(v) => cap({ words: v })} />
      </div>
      <div className="mt-2">
        <Switch label="ALL CAPS" hint="Easier to read on a phone" on={c.upper} onChange={(v) => cap({ upper: v })} />
        <Switch label="Black outline" hint="Keeps text readable on bright scenes" on={c.outline} onChange={(v) => cap({ outline: v })} />
        <Switch label="Hide swear words" hint="f*** instead of the word. TikTok and YouTube show clean shorts to more people." on={c.censor} onChange={(v) => cap({ censor: v })} />
      </div>
    </>
  );
}

export function HookControls({ style: s, set, example, onExample }: { style: Style; set: Set; example?: string; onExample?: (v: string) => void }) {
  const h = s.hook;
  const hook = (patch: Partial<Style["hook"]>) => set((x) => ({ ...x, hook: { ...x.hook, ...patch } }));
  return (
    <>
      <Switch label="Show an opening line" hint="Tells scrollers why to stay" on={h.on} onChange={(v) => hook({ on: v })} />
      <div className={cn("mt-2 grid grid-cols-2 gap-3.5 sm:grid-cols-3", !h.on && "pointer-events-none opacity-40")}>
        <Pick label="Style" value={h.style} options={[["white", "White box"], ["yellow", "Yellow box"], ["plain", "Text only"]]} onChange={(v) => hook({ style: v })} />
        <Range label="Shown for" value={h.sec} shown={`${h.sec} s`} min={2} max={6} onChange={(v) => hook({ sec: v })} />
        {onExample && (
          <label className="col-span-2 grid gap-1.5 sm:col-span-1">
            <span className="text-xs font-medium text-muted-foreground">Example (the AI writes one per short)</span>
            <input value={example} onChange={(e) => onExample(e.target.value)} maxLength={60} className={field} />
          </label>
        )}
      </div>
    </>
  );
}

export function ExtraControls({ style: s, set, noLogos }: { style: Style; set: Set; noLogos?: boolean }) {
  return (
    <div>
      <Switch label="Flash the best part first" hint="1.5 seconds of the big reaction at the start, then the story. Stops the scroll." on={s.flash} onChange={(v) => set((x) => ({ ...x, flash: v }))} />
      <Switch label="Zoom in on big reactions" hint="A quick push-in on the facecam when the stream gets loud" on={s.zoom} onChange={(v) => set((x) => ({ ...x, zoom: v }))} />
      <Switch label="Progress bar" hint="A thin bar along the bottom: people watch to the end" on={s.progress} onChange={(v) => set((x) => ({ ...x, progress: v }))} />
      {noLogos && <Switch label="Your @handle on screen" hint="Off for this campaign: it doesn't allow logos or overlays" on={false} onChange={() => {}} disabled />}
    </div>
  );
}
