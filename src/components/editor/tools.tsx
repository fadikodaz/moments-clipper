"use client";

import type { ReactNode } from "react";
import { Clock, Layers, Sparkles, Subtitles, Type } from "lucide-react";
import { field } from "@/components/kit";
import { ColorPick, Fold, Select } from "@/components/ui/controls";
import { Range, Switch } from "@/components/setup/controls";
import { CAPTION_PRESETS, FONTS, HOOK_PRESETS, captionPreset, cssFont, type Layout, type Style } from "@/components/setup/style";
import { cn } from "@/lib/utils";
import { DEFAULT_BOX } from "@/components/setup/frame-editor";

export type ToolKey = "hook" | "cap" | "layout" | "time" | "fx";
type SetStyle = (fn: (s: Style) => Style) => void;

const TOOL_META: Record<ToolKey, [string, typeof Type]> = {
  hook: ["Opening line", Type],
  cap: ["Captions", Subtitles],
  layout: ["Layout", Layers],
  time: ["Timing", Clock],
  fx: ["Effects", Sparkles],
};

/** The row of tools on top: one panel at a time; a dot marks tools with changes. */
export function ToolBar({ tools, active, onPick, changed, labels }: { tools: ToolKey[]; active: ToolKey; onPick: (t: ToolKey) => void; changed?: Partial<Record<ToolKey, boolean>>; labels?: Partial<Record<ToolKey, string>> }) {
  return (
    <div role="tablist" aria-label="Tools" className="mb-4 flex gap-1 rounded-[14px] border bg-panel p-1">
      {tools.map((t) => {
        const [label, Icon] = TOOL_META[t];
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={active === t}
            onClick={() => onPick(t)}
            className={cn(
              "grid flex-1 justify-items-center gap-1 rounded-[10px] px-1 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground [&_svg]:size-5",
              active === t && "bg-raised text-foreground shadow-[0_0_0_1px_var(--border-strong)]",
            )}
          >
            <Icon aria-hidden="true" />
            <span className="text-center leading-tight">{labels?.[t] ?? label}</span>
            <span className={cn("-mt-0.5 size-1.5 rounded-full bg-moment", !changed?.[t] && "invisible")} />
          </button>
        );
      })}
    </div>
  );
}

export function Panel({ title, children }: { title: string; /** Kept for callers; not shown, to keep panels calm. */ lead?: string; children: ReactNode }) {
  return (
    <section role="tabpanel" className="grid gap-[18px] rounded-2xl border bg-panel p-[18px]">
      <h2 className="font-sans text-base font-semibold tracking-normal">{title}</h2>
      {children}
    </section>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="mb-2 block text-xs font-semibold text-muted-foreground">{children}</span>;
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-[11px] border bg-background p-[3px]">
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={cn("h-[34px] flex-1 whitespace-nowrap rounded-lg px-2.5 text-[13px] font-semibold text-muted-foreground", value === v && "bg-raised text-foreground shadow-[0_0_0_1px_var(--border-strong)]")}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** Extra settings, closed by default so each panel stays calm. */
export function More({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Fold title={title}>{children}</Fold>
  );
}

function Color({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <ColorPick label={label} value={value} onChange={onChange} disabled={disabled} />
  );
}

function FontPick({ value, onChange }: { value: Style["captions"]["font"]; onChange: (v: Style["captions"]["font"]) => void }) {
  return (
    <Select label="Font" value={value} onChange={onChange} options={FONTS.map(([k, l]) => [k, <span key={k} style={{ fontFamily: cssFont(k) }}>{l}</span>] as const)} />
  );
}

function Preset({ on, label, frame, onClick, children }: { on: boolean; label: string; frame: string | null; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("grid gap-[7px] rounded-xl border bg-raised p-2 text-xs font-medium text-muted-foreground hover:border-border-strong", on && "border-foreground bg-raised text-foreground")}>
      <span className="grid h-[46px] place-items-center overflow-hidden rounded-lg bg-[#2a2d33] bg-cover bg-center px-1" style={frame ? { backgroundImage: `url(${frame})` } : undefined}>
        {children}
      </span>
      {label}
    </button>
  );
}

/* ---------------- opening line ---------------- */

export function HookPanel({ style: s, set, text, onText, frame, mention }: { style: Style; set: SetStyle; text?: string; onText?: (v: string) => void; frame: string | null; mention?: string }) {
  const h = s.hook;
  const hook = (patch: Partial<Style["hook"]>) => set((x) => ({ ...x, hook: { ...x.hook, ...patch } }));
  const split = s.layout === "top" || s.layout === "bottom";
  return (
    <Panel title="Opening line" lead={`The line that tells scrollers why to stay. The AI writes one per short${mention ? ` and always names ${mention}` : ""}; change it if you like.`}>
      <Switch label="Show an opening line" on={h.on} onChange={(v) => hook({ on: v })} />
      <div className={cn("grid gap-[18px]", !h.on && "pointer-events-none opacity-40")}>
        {onText && <input value={text ?? ""} onChange={(e) => onText(e.target.value)} maxLength={70} aria-label="Opening line text" placeholder="Write an opening line" className={field} />}
        <div>
          <Label>Style</Label>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(98px,1fr))] gap-2">
            {HOOK_PRESETS.map(([k, label, fg, bg]) => (
              <Preset key={k} on={h.style === k} label={label} frame={frame} onClick={() => hook({ style: k, fg, bg })}>
                <b className="rounded px-1.5 py-0.5 text-[11px] leading-tight" style={{ fontFamily: cssFont("Montserrat"), ...(bg ? { background: bg, color: fg } : { color: fg, textShadow: "0 0 3px #000, 0 0 3px #000" }) }}>
                  {mention || "Opening"}
                </b>
              </Preset>
            ))}
          </div>
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <Label>Show it</Label>
            <Seg label="Show it" value={h.show} options={[["start", "At the start"], ["all", "Whole video"]]} onChange={(v) => hook({ show: v })} />
          </div>
          <div>
            <Label>Where</Label>
            <Seg label="Where" value={h.pos} options={[["gap", split ? "In the gap" : "Auto"], ["top", "Top"], ["custom", "Custom"]]} onChange={(v) => hook({ pos: v })} />
          </div>
        </div>
        {h.pos === "gap" && split && s.gap < 1 && (
          <p className="-mt-2 text-[13px] text-muted-foreground">
            No gap yet, so it sits on the line between facecam and gameplay.{" "}
            <button type="button" onClick={() => set((x) => ({ ...x, gap: 7 }))} className="font-semibold text-foreground underline underline-offset-[3px]">
              Add a gap
            </button>
          </p>
        )}
        {h.pos === "custom" && <p className="-mt-2 text-[13px] text-muted-foreground">Drag the opening line on the preview to place it.</p>}
        <More title="More options: font, colours, size">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <FontPick value={h.font} onChange={(v) => hook({ font: v, style: "custom" })} />
            <Range label="Size" value={h.size} min={12} max={28} onChange={(v) => hook({ size: v })} />
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Color label="Text colour" value={h.fg} onChange={(v) => hook({ fg: v, style: "custom" })} />
            <div>
              <Label>Behind the text</Label>
              <Seg label="Behind the text" value={h.bg ? "box" : "none"} options={[["box", "Box"], ["none", "No box"]]} onChange={(v) => hook({ bg: v === "box" ? "#ffffff" : null, style: "custom", ...(v === "none" && h.fg === "#000000" ? { fg: "#ffffff" } : {}) })} />
            </div>
          </div>
          {h.bg ? (
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Color label="Box colour" value={h.bg} onChange={(v) => hook({ bg: v, style: "custom" })} />
              <Range label="Box see-through" value={h.op} shown={`${h.op}%`} min={0} max={80} step={5} onChange={(v) => hook({ op: v })} />
            </div>
          ) : (
            <p className="-mt-1 text-[13px] text-muted-foreground">Without a box the text gets a black outline, so it stays readable.</p>
          )}
          {h.show === "start" && <Range label="Shown for" value={h.sec} shown={`${h.sec} s`} min={2} max={8} onChange={(v) => hook({ sec: v })} />}
        </More>
      </div>
    </Panel>
  );
}

/* ---------------- captions ---------------- */

export function CaptionPanel({ style: s, set, frame, who, extra }: { style: Style; set: SetStyle; frame: string | null; who?: string; extra?: ReactNode }) {
  const c = s.captions;
  const cap = (patch: Partial<Style["captions"]>) => set((x) => ({ ...x, captions: { ...x.captions, ...patch } }));
  const preset = captionPreset(c);
  return (
    <Panel title="Captions" lead={`The words ${who || "the streamer"} says, on screen. Pick a look, then drag them on the preview to move them.`}>
      <div>
        <Label>Look</Label>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(98px,1fr))] gap-2">
          {CAPTION_PRESETS.map(([k, label, p]) => (
            <Preset key={k} on={preset === k} label={label} frame={frame} onClick={() => cap(p)}>
              {k === "none" ? (
                <b className="text-white/60">—</b>
              ) : (
                <b
                  className="rounded px-1 text-[11px] leading-tight"
                  style={{
                    fontFamily: cssFont(p.font!),
                    color: p.color,
                    textTransform: p.upper ? "uppercase" : "none",
                    ...(p.style === "box" ? { background: "rgba(0,0,0,.65)" } : { textShadow: "-1px -1px 0 #000, 1px 1px 0 #000, 0 0 3px #000" }),
                  }}
                >
                  oh <span style={{ color: p.hl }}>my</span> gosh
                </b>
              )}
            </Preset>
          ))}
        </div>
      </div>
      {c.style !== "none" && (
        <>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Range label="Size" value={c.size} min={16} max={44} onChange={(v) => cap({ size: v })} />
            <Range label="Height on screen" value={c.y} shown={`${c.y}%`} min={15} max={88} onChange={(v) => cap({ y: v })} />
          </div>
          <Switch label="Hide swear words" hint="f*** instead of the word: TikTok and YouTube show clean shorts to more people" on={c.censor} onChange={(v) => cap({ censor: v })} />
          <More title="More options: font, colours, words">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <FontPick value={c.font} onChange={(v) => cap({ font: v })} />
              <Range label="Words at a time" value={c.words} min={1} max={6} onChange={(v) => cap({ words: v })} />
            </div>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Color label="Text colour" value={c.color} onChange={(v) => cap({ color: v })} />
              <Color label="Spoken word colour" value={c.hl} onChange={(v) => cap({ hl: v })} disabled={c.style === "box"} />
            </div>
            <Seg label="Caption style" value={c.style === "box" ? "box" : "word"} options={[["word", "Word by word"], ["box", "Lines in a box"]]} onChange={(v) => cap({ style: v })} />
            <Switch label="ALL CAPS" hint="Easier to read on a phone" on={c.upper} onChange={(v) => cap({ upper: v })} />
            <Switch label="Black outline" hint="Readable on bright scenes" on={c.outline} onChange={(v) => cap({ outline: v })} />
          </More>
          {extra}
        </>
      )}
    </Panel>
  );
}

/* ---------------- layout ---------------- */

const LAYOUT_LIST: [Layout, string][] = [
  ["top", "Cam top"],
  ["bottom", "Cam bottom"],
  ["pip", "Small cam"],
  ["game", "Game only"],
  ["full", "Whole screen"],
];

function LayoutIcon({ k }: { k: Layout }) {
  const cam = "#ff7448", game = "#5b6070";
  const r = (x: number, y: number, w: number, h: number, f: string) => <rect x={x} y={y} width={w} height={h} rx={2} fill={f} />;
  return (
    <svg viewBox="0 0 30 52" className="h-[46px] w-[26px]" aria-hidden="true">
      {k === "top" && <>{r(1, 1, 28, 16, cam)}{r(1, 21, 28, 30, game)}</>}
      {k === "bottom" && <>{r(1, 1, 28, 30, game)}{r(1, 35, 28, 16, cam)}</>}
      {k === "pip" && <>{r(1, 1, 28, 50, game)}{r(17, 4, 10, 9, cam)}</>}
      {k === "game" && r(1, 1, 28, 50, game)}
      {k === "full" && <>{r(1, 1, 28, 50, "#3a3d44")}{r(1, 18, 28, 16, game)}</>}
    </svg>
  );
}

export function LayoutPanel({ style: s, set, hasCam, who, camEditor }: { style: Style; set: SetStyle; hasCam: boolean; who?: string; camEditor?: ReactNode }) {
  const split = s.layout === "top" || s.layout === "bottom";
  const focus = s.focus < 0.4 ? "Left" : s.focus > 0.6 ? "Right" : "Middle";
  return (
    <Panel title="Layout" lead={`Where ${who ? `${who}'s` : "the"} facecam and the gameplay go.`}>
      <div role="group" aria-label="Layout" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {LAYOUT_LIST.map(([k, label]) => {
          const needsCam = k === "top" || k === "bottom" || k === "pip";
          return (
            <button
              key={k}
              type="button"
              aria-pressed={s.layout === k}
              title={needsCam && !hasCam ? "No facecam found yet: we'll place a box for you to drag onto the face" : undefined}
              onClick={() => set((x) => ({ ...x, layout: k, nocam: needsCam ? false : x.nocam, cam: needsCam && !hasCam ? (x.cam ?? DEFAULT_BOX) : x.cam }))}
              className={cn("grid justify-items-center gap-1.5 rounded-xl border bg-raised px-1 py-2.5 text-[11px] leading-tight font-medium text-muted-foreground disabled:opacity-35", s.layout === k && "border-foreground bg-raised text-foreground")}
            >
              <LayoutIcon k={k} />
              {label}
            </button>
          );
        })}
      </div>
      {split && (
        <>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Range label="Facecam size" value={s.camPct} shown={`${s.camPct}%`} min={22} max={50} onChange={(v) => set((x) => ({ ...x, camPct: v }))} />
            <Range label="Gap between them" value={s.gap} shown={`${s.gap}%`} min={0} max={14} onChange={(v) => set((x) => ({ ...x, gap: v }))} />
          </div>
          {s.gap >= 1 && (
            <div>
              <Label>Gap colour</Label>
              <Seg label="Gap colour" value={s.gapStyle} options={[["black", "Black"], ["blur", "Blurred"], ["color", "Colour"]]} onChange={(v) => set((x) => ({ ...x, gapStyle: v }))} />
              {s.gapStyle === "color" && <div className="mt-3 max-w-[200px]"><Color label="Colour" value={s.gapColor} onChange={(v) => set((x) => ({ ...x, gapColor: v }))} /></div>}
              <p className="mt-2 text-[13px] text-muted-foreground">The opening line sits in this gap, centred, so it never covers the facecam or the game.</p>
            </div>
          )}
        </>
      )}
      {s.layout === "pip" && (
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <Label>Corner</Label>
            <Seg label="Corner" value={s.pipCorner} options={[["tl", "↖"], ["tr", "↗"], ["bl", "↙"], ["br", "↘"]]} onChange={(v) => set((x) => ({ ...x, pipCorner: v }))} />
          </div>
          <Range label="Facecam size" value={s.pipSize} shown={`${s.pipSize}%`} min={25} max={60} onChange={(v) => set((x) => ({ ...x, pipSize: v }))} />
        </div>
      )}
      {camEditor}
      {s.layout !== "full" && (
        <More title="More options: part of the gameplay">
          <Range label="Part of the gameplay shown" value={Math.round(s.focus * 100)} shown={focus} min={0} max={100} onChange={(v) => set((x) => ({ ...x, focus: v / 100 }))} />
        </More>
      )}
    </Panel>
  );
}

/* ---------------- effects ---------------- */

export function EffectsPanel({ style: s, set, noLogos }: { style: Style; set: SetStyle; noLogos?: boolean }) {
  return (
    <Panel title="Effects" lead="Small things that keep people watching.">
      <div>
        <Switch label="Start with the best moment" hint="1.5 seconds of the big reaction first, then the story" on={s.flash} onChange={(v) => set((x) => ({ ...x, flash: v }))} />
        <Switch label="Zoom in on big reactions" hint="A quick push-in on the facecam when it gets loud" on={s.zoom} onChange={(v) => set((x) => ({ ...x, zoom: v }))} />
        <Switch label="Progress bar" hint="A thin bar along the bottom" on={s.progress} onChange={(v) => set((x) => ({ ...x, progress: v }))} />
        {noLogos && <Switch label="Your @handle on screen" hint="Off for this campaign: it doesn't allow logos or overlays" on={false} onChange={() => {}} disabled />}
      </div>
    </Panel>
  );
}
