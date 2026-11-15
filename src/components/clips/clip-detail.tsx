"use client";

import Link from "next/link";
import { useId } from "react";
import { Check, CornerDownLeft, TriangleAlert, X } from "lucide-react";
import { CAPTION_STYLES, LAYOUTS, formatDuration, type CaptionStyle, type ClipLayout } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { scoreTier, type ClipPatch, type ReviewClip } from "./types";

export const controlClass =
  "h-[30px] w-full rounded-md border bg-panel px-2.5 text-xs text-foreground outline-none hover:border-border-strong focus-visible:border-border-strong";

export function ScorePill({ score }: { score: number }) {
  const tier = scoreTier(score);
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5 rounded-full px-2 py-0.5 font-mono text-xs whitespace-nowrap",
        tier.top ? "bg-moment-soft text-moment" : "bg-raised text-muted-foreground",
      )}
    >
      {score} <span>{tier.label}</span>
    </span>
  );
}

const BREAKDOWN: [keyof ReviewClip["sub"], string][] = [
  ["hook", "Opening hook"],
  ["action", "Action on screen"],
  ["reaction", "Your reaction"],
  ["clarity", "Easy to follow"],
];

export function WhyThisClip({ clip }: { clip: ReviewClip }) {
  return (
    <section className="border-t pt-3" aria-label="Why this clip">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold">Why this clip</h3>
        <ScorePill score={clip.score} />
      </div>
      {BREAKDOWN.map(([key, label]) => (
        <div key={key} className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{label}</span>
          <b className="font-mono font-medium text-foreground">{clip.sub[key]}</b>
          <i className="col-span-2 h-[3px] overflow-hidden rounded-full bg-raised" aria-hidden="true">
            <em className="block h-full bg-foreground" style={{ width: `${clip.sub[key]}%` }} />
          </i>
        </div>
      ))}
      <p className="mt-2 text-xs text-muted-foreground">{clip.reason}</p>
      {clip.warning && (
        <p className="mt-2 flex gap-2 rounded-md border border-warn/35 bg-warn/8 px-2.5 py-2 text-xs text-[#fde68a]">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {clip.warning}
        </p>
      )}
    </section>
  );
}

export function ClipInfo({ clip, onPatch, onDecide }: { clip: ReviewClip; onPatch: (p: ClipPatch) => void; onDecide: (s: "kept" | "removed") => void }) {
  const ids = { layout: useId(), caption: useId(), hook: useId() };
  const kbd = "text-[11px] text-subtle";

  return (
    <div className="grid content-start gap-3.5">
      <div>
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{clip.title}</h2>
        <p className="font-mono text-[11px] text-subtle">
          {formatDuration(clip.startSec)} to {formatDuration(clip.startSec + clip.durSec)}, {clip.durSec} s
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onDecide("kept")}
          aria-keyshortcuts="A"
          aria-pressed={clip.status === "kept"}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium",
            clip.status === "kept" ? "border-good/40 bg-raised text-good" : "border-foreground bg-foreground text-background hover:bg-[#e4e4e7]",
          )}
        >
          {clip.status === "kept" ? <Check className="size-3.5" aria-hidden="true" /> : null}
          {clip.status === "kept" ? "Kept" : "Keep"} <span aria-hidden="true" className={clip.status === "kept" ? kbd : "text-[11px] opacity-60"}>A</span>
        </button>
        <button
          type="button"
          onClick={() => onDecide("removed")}
          aria-keyshortcuts="X"
          aria-pressed={clip.status === "removed"}
          className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border bg-raised px-2.5 text-xs font-medium hover:bg-hover", clip.status === "removed" && "text-bad")}
        >
          {clip.status === "removed" ? "Removed" : "Remove"} <X className="size-3 text-subtle" aria-hidden="true" />
        </button>
        <Link href={`/clips/${clip.id}/edit`} aria-keyshortcuts="Enter" className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-raised px-2.5 text-xs font-medium hover:bg-hover">
          Open editor <CornerDownLeft className="size-3 text-subtle" aria-hidden="true" />
        </Link>
      </div>

      <div className="grid grid-cols-[70px_1fr] items-center gap-2 text-xs text-muted-foreground">
        <label htmlFor={ids.layout}>Layout</label>
        <select id={ids.layout} className={controlClass} value={clip.layout} onChange={(e) => onPatch({ layout: e.target.value as ClipLayout })}>
          {LAYOUTS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <label htmlFor={ids.caption}>Captions</label>
        <select id={ids.caption} className={controlClass} value={clip.caption} onChange={(e) => onPatch({ caption: e.target.value as CaptionStyle })}>
          {CAPTION_STYLES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label htmlFor={ids.hook}>Opening</label>
        <input id={ids.hook} className={controlClass} value={clip.hook} maxLength={60} onChange={(e) => onPatch({ hook: e.target.value })} />
      </div>

      <blockquote className="border-l-2 border-border-strong pl-2.5 text-xs text-muted-foreground italic">&ldquo;{clip.words}&rdquo;</blockquote>

      <WhyThisClip clip={clip} />
    </div>
  );
}
