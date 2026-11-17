"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Download, Eye, EyeOff, Heart } from "lucide-react";
import type { ReviewMap } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { formatTime, type Short } from "./model";
import { ScoreBadge, SaveButton, btn, btnLg, btnSm } from "./parts";

type Props = {
  short: Short;
  list: Short[];
  best: number;
  review: ReviewMap;
  onGo: (id: string) => void;
  onBack: () => void;
  onSave: (id: string) => void;
  onHide: (id: string) => void;
};

export function WatchView({ short, list, best, review, onGo, onBack, onSave, onHide }: Props) {
  const n = list.findIndex((s) => s.id === short.id);
  const prev = n > 0 ? list[n - 1] : null;
  const next = n >= 0 && n < list.length - 1 ? list[n + 1] : null;
  const saved = review[short.id] === "saved";
  const hidden = review[short.id] === "hidden";
  const current = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest" });
  }, [short.id]);

  // Arrows flip through, S saves, Esc goes back to all shorts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (k === "arrowleft" && prev) onGo(prev.id);
      else if (k === "arrowright" && next) onGo(next.id);
      else if (k === "s") onSave(short.id);
      else if (k === "escape") onBack();
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, short.id, onGo, onSave, onBack]);

  const arrow = "absolute top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-border-strong bg-raised/90 hover:bg-hover disabled:pointer-events-none disabled:opacity-30";

  return (
    <div>
      <button type="button" onClick={onBack} className={cn(btn, btnSm, "mb-3.5 border-transparent bg-transparent text-muted-foreground hover:text-foreground")}>
        <ChevronLeft aria-hidden="true" /> All shorts
      </button>

      <div className="grid gap-8 xl:grid-cols-[1fr_360px]">
        <section className="grid items-start gap-[30px] md:grid-cols-[auto_1fr]">
          <div className="relative justify-self-center">
            <video
              key={short.id}
              src={short.videoUrl}
              poster={short.posterUrl}
              controls
              autoPlay
              playsInline
              aria-label={`Video: ${short.title}`}
              className="block aspect-[9/16] w-[min(100%,340px)] rounded-[18px] border bg-black md:h-[min(calc(100dvh-170px),720px)] md:w-auto"
            />
            <button type="button" onClick={() => prev && onGo(prev.id)} disabled={!prev} aria-label="Previous short" className={cn(arrow, "left-1 md:-left-[22px]")}>
              <ChevronLeft className="size-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => next && onGo(next.id)} disabled={!next} aria-label="Next short" className={cn(arrow, "right-1 md:-right-[22px]")}>
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </div>

          <div className="min-w-0">
            <ScoreBadge score={short.score} best={best} />
            <h1 className="mt-2 mb-2 text-[28px] leading-[1.15] font-[650] tracking-[-0.03em]">{short.title}</h1>
            <p className="text-[13px] text-muted-foreground">
              {Math.round(short.durSec)} seconds, from {formatTime(short.startSec)} in your video
            </p>

            <div className="my-[22px] flex flex-wrap gap-2.5 max-sm:[&>*]:flex-1">
              <a href={short.videoUrl} download={short.downloadName} className={cn(btn, btnLg, "border-foreground bg-foreground text-background hover:bg-[#e4e4e7]")}>
                <Download aria-hidden="true" /> Download
              </a>
              <SaveButton saved={saved} onClick={() => onSave(short.id)} large withLabel />
              <button type="button" onClick={() => onHide(short.id)} className={cn(btn, btnLg, "border-transparent bg-transparent text-muted-foreground hover:text-foreground")}>
                {hidden ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
                {hidden ? "Show again" : "Hide"}
              </button>
            </div>

            <div className="rounded-[14px] border bg-panel px-4 py-3.5">
              <h2 className="mb-1.5 text-[13px] font-semibold">Why this is a good short</h2>
              <p className="mb-3 max-w-[52ch] text-[15px] text-muted-foreground">{short.reason}</p>
              <details>
                <summary className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground">What you said in this short</summary>
                <p className="mt-2 max-w-[60ch] text-[13px] text-muted-foreground italic">&ldquo;{short.words}&rdquo;</p>
              </details>
            </div>
            <p className="mt-4 text-[13px] text-muted-foreground">
              Short {n + 1} of {list.length}. Use the arrow keys to flip through.
            </p>
          </div>
        </section>

        <aside>
          <h2 className="mb-2.5 text-base font-semibold">Up next</h2>
          <div className="grid max-h-[calc(100dvh-160px)] gap-1 overflow-y-auto pr-1 max-xl:max-h-none">
            {list.map((s) => (
              <button
                key={s.id}
                ref={s.id === short.id ? current : undefined}
                type="button"
                onClick={() => onGo(s.id)}
                aria-current={s.id === short.id ? "true" : undefined}
                className={cn("grid grid-cols-[58px_1fr] gap-3 rounded-xl border border-transparent p-2 text-left hover:bg-panel", s.id === short.id && "border-border-strong bg-raised hover:bg-raised")}
              >
                <span className="block aspect-[9/16] overflow-hidden rounded-lg bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element -- poster served by our own route */}
                  <img src={s.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                </span>
                <span className="min-w-0">
                  <b className="mb-1.5 block text-sm leading-[1.3] font-medium">{s.title}</b>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ScoreBadge score={s.score} best={best} className="px-2 text-xs [&_b]:text-xs" />
                    {formatTime(s.durSec)}
                    {review[s.id] === "saved" && <Heart className="size-3.5 fill-moment text-moment" aria-label="Saved" />}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
