"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Ellipsis, Eye, EyeOff, Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime, scoreLabel, type Short } from "./model";

export function ScoreBadge({ score, best, solid, className }: { score: number; best: number; solid?: boolean; className?: string }) {
  const { label, top } = scoreLabel(score, best);
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] whitespace-nowrap",
        top ? (solid ? "bg-moment text-moment-ink" : "bg-moment-soft text-moment") : solid ? "bg-background/80 text-muted-foreground backdrop-blur-sm" : "bg-raised text-muted-foreground",
        className,
      )}
    >
      <b className={cn("font-mono text-sm font-semibold", top ? "" : "text-foreground")}>{score}</b>
      {label}
    </span>
  );
}

export const btn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-border-strong bg-raised font-semibold whitespace-nowrap transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-[18px] [&_svg]:shrink-0";
export const btnSm = "h-[34px] px-3 text-[13px] rounded-[9px] [&_svg]:size-4";
export const btnLg = "h-11 px-[18px] text-[15px]";

export function SaveButton({ saved, onClick, large, withLabel }: { saved: boolean; onClick: () => void; large?: boolean; withLabel?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={saved}
      aria-label={withLabel ? undefined : saved ? "Saved" : "Save"}
      title={saved ? "Saved" : "Save"}
      className={cn(btn, large ? btnLg : btnSm, saved && "border-moment/50 bg-moment-soft text-moment hover:bg-moment-soft")}
    >
      <Heart className={cn(saved && "fill-current")} aria-hidden="true" />
      {withLabel && (saved ? "Saved" : "Save")}
      {withLabel && large && <kbd className="rounded-[5px] border border-current px-1.5 font-mono text-[11px] font-medium opacity-55">S</kbd>}
    </button>
  );
}

/** Hover plays a muted preview; click opens the watch view. */
export function ShortCard({ short, best, saved, hidden, onOpen, onSave, onHide }: { short: Short; best: number; saved: boolean; hidden: boolean; onOpen: () => void; onSave: () => void; onHide: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  function start() {
    const v = video.current;
    if (!v || window.matchMedia("(hover: none)").matches) return;
    v.preload = "auto";
    v.currentTime = 0;
    v.play().then(() => setPlaying(true)).catch(() => {});
  }
  function stop() {
    video.current?.pause();
    setPlaying(false);
  }

  return (
    <article className="relative grid content-start gap-2.5">
      <button
        type="button"
        onClick={onOpen}
        onMouseEnter={start}
        onMouseLeave={stop}
        onFocus={start}
        onBlur={stop}
        aria-label={`Watch ${short.title}`}
        className="relative block aspect-[9/16] overflow-hidden rounded-[18px] border bg-black transition-colors hover:border-border-strong"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- poster served by our own route */}
        <img src={short.posterUrl} alt="" loading="lazy" className={cn("absolute inset-0 h-full w-full object-cover", hidden && "brightness-50 grayscale")} />
        <video ref={video} src={short.videoUrl} muted loop playsInline preload="none" className={cn("absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity", playing && "opacity-100")} />
        <ScoreBadge score={short.score} best={best} solid className="absolute top-2 left-2" />
        {saved && (
          <span className="absolute top-2 right-2 grid size-[30px] place-items-center rounded-full bg-foreground text-moment">
            <Heart className="size-4 fill-current" aria-hidden="true" />
          </span>
        )}
        <span className="absolute right-2 bottom-2 rounded-md bg-background/80 px-[7px] font-mono text-xs font-medium">{formatTime(short.durSec)}</span>
      </button>

      <h2 className="line-clamp-2 min-h-[2.7em] text-[15px] leading-[1.35] font-semibold tracking-[-0.01em]">{short.title}</h2>

      <div className="grid grid-cols-[1fr_auto_auto] gap-1.5">
        <a href={short.videoUrl} download={short.downloadName} className={cn(btn, btnSm)}>
          <Download aria-hidden="true" />
          <span className="max-sm:sr-only">Download</span>
        </a>
        <SaveButton saved={saved} onClick={onSave} />
        <span ref={menuRef} className="relative">
          <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="More options" className={cn(btn, btnSm, "border-transparent bg-transparent text-muted-foreground hover:text-foreground")}>
            <Ellipsis aria-hidden="true" />
          </button>
          {menu && (
            <span className="absolute right-0 bottom-10 z-10 min-w-[160px] rounded-xl border border-border-strong bg-raised p-1 shadow-[0_16px_40px_rgb(0_0_0/0.5)]">
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  onHide();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-hover"
              >
                {hidden ? <Eye className="size-4" aria-hidden="true" /> : <EyeOff className="size-4" aria-hidden="true" />}
                {hidden ? "Show again" : "Hide this short"}
              </button>
            </span>
          )}
        </span>
      </div>
    </article>
  );
}
