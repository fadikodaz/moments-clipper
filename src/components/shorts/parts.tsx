"use client";

import { useRef, useState } from "react";
import { Check, Copy, Download, Ellipsis, Eye, EyeOff, Scissors, Trash2 } from "lucide-react";
import { Menu, MenuItem, Score, formatTime } from "@/components/kit";
import { cn } from "@/lib/utils";
import type { Short } from "./model";

const roundBtn =
  "group/ib relative grid size-[34px] place-items-center rounded-full bg-[#f4f4f5]/95 text-[#111] transition-[transform,background-color] hover:scale-108 hover:bg-white [@media(hover:hover)]:size-[38px] [&_svg]:size-[17px]";

function Tip({ children }: { children: string }) {
  return (
    <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 rounded-md border border-border-strong bg-raised px-2 py-1 text-xs whitespace-nowrap text-foreground opacity-0 transition-opacity group-hover/ib:opacity-100 group-focus-visible/ib:opacity-100">
      {children}
    </span>
  );
}

type CardProps = {
  short: Short;
  best: number;
  hidden: boolean;
  selecting: boolean;
  selected: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onHide: () => void;
  onDelete: () => void;
};

/** A clean card: hover lifts it and plays a silent preview; the actions sit on the cover. */
export function ShortCard({ short, best, hidden, selecting, selected, onOpen, onEdit, onCopy, onHide, onDelete }: CardProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [menu, setMenu] = useState(false);

  function start() {
    const v = video.current;
    if (!v || selecting || window.matchMedia("(hover: none)").matches) return;
    v.preload = "auto";
    v.currentTime = 0;
    v.play().then(() => setPlaying(true)).catch(() => {});
  }
  function stop() {
    video.current?.pause();
    setPlaying(false);
  }

  const showActs = !selecting;
  return (
    <article className="group/card relative grid content-start gap-2.5">
      <div
        role="button"
        tabIndex={0}
        aria-label={`${selecting ? (selected ? "Unselect" : "Select") : "Watch"} ${short.title}`}
        aria-pressed={selecting ? selected : undefined}
        onClick={(e) => !(e.target as HTMLElement).closest("[data-acts]") && onOpen()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            onOpen();
          }
        }}
        onMouseEnter={start}
        onMouseLeave={stop}
        className={cn(
          "relative aspect-[9/16] cursor-pointer overflow-hidden rounded-[18px] bg-black outline-1 -outline-offset-1 outline-border transition-[transform,outline-color] duration-200",
          "[@media(hover:hover)]:group-hover/card:-translate-y-[3px] [@media(hover:hover)]:group-hover/card:outline-border-strong",
          selected && "outline-[3px] -outline-offset-[3px] outline-moment group-hover/card:outline-moment",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- poster served by our own route */}
        <img src={short.posterUrl} alt="" loading="lazy" className={cn("absolute inset-0 h-full w-full object-cover", hidden && "brightness-[0.55] grayscale")} />
        <video ref={video} src={short.videoUrl} muted loop playsInline preload="none" className={cn("absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-250", playing && "opacity-100")} />

        {selecting ? (
          <span className={cn("absolute top-2.5 left-2.5 grid size-[26px] place-items-center rounded-full border-2 border-white/85 bg-black/35 text-transparent", selected && "border-moment bg-moment text-moment-ink")}>
            <Check className="size-[15px]" strokeWidth={3} aria-hidden="true" />
          </span>
        ) : (
          <Score score={short.score} best={best} className="absolute top-2.5 left-2.5" />
        )}
        <span
          className={cn(
            "absolute right-2.5 bottom-2.5 rounded-md bg-background/85 px-[7px] font-mono text-xs font-medium transition-opacity [@media(hover:none)]:hidden",
            showActs && "group-focus-within/card:opacity-0 group-hover/card:opacity-0",
            menu && "opacity-0",
          )}
        >
          {formatTime(short.durSec)}
        </span>

        {showActs && (
          <div
            data-acts
            className={cn(
              "absolute inset-x-0 bottom-0 flex justify-end gap-1.5 bg-gradient-to-b from-transparent to-black/70 px-2.5 pt-[30px] pb-2.5 transition-[opacity,transform] duration-200 [@media(hover:hover)]:pt-10",
              "[@media(hover:hover)]:translate-y-1.5 [@media(hover:hover)]:opacity-0 group-focus-within/card:translate-y-0 group-focus-within/card:opacity-100 group-hover/card:translate-y-0 group-hover/card:opacity-100",
              menu && "translate-y-0 opacity-100",
            )}
          >
            <a href={short.videoUrl} download={short.downloadName} aria-label="Download" className={roundBtn}>
              <Download aria-hidden="true" />
              <Tip>Download</Tip>
            </a>
            <button type="button" onClick={onEdit} aria-label="Edit" className={roundBtn}>
              <Scissors aria-hidden="true" />
              <Tip>Edit</Tip>
            </button>
            <span className="relative">
              <button type="button" onClick={() => setMenu((m) => !m)} aria-label="More options" aria-expanded={menu} className={roundBtn}>
                <Ellipsis aria-hidden="true" />
                {!menu && <Tip>More</Tip>}
              </button>
              <Menu open={menu} onClose={() => setMenu(false)} className="bottom-[calc(100%+8px)]">
                <MenuItem
                  icon={<Copy />}
                  onClick={() => {
                    setMenu(false);
                    onCopy();
                  }}
                >
                  Copy post caption
                </MenuItem>
                <MenuItem
                  icon={hidden ? <Eye /> : <EyeOff />}
                  onClick={() => {
                    setMenu(false);
                    onHide();
                  }}
                >
                  {hidden ? "Show again" : "Hide from this project"}
                </MenuItem>
                <MenuItem
                  icon={<Trash2 />}
                  danger
                  onClick={() => {
                    setMenu(false);
                    onDelete();
                  }}
                >
                  Delete short
                </MenuItem>
              </Menu>
            </span>
          </div>
        )}
      </div>

      <h2 className="line-clamp-2 text-[15px] leading-[1.35] font-semibold tracking-[-0.01em]">{short.title}</h2>
      <small className="-mt-1.5 text-[13px] text-subtle">
        {formatTime(short.durSec)} long, at {formatTime(short.startSec)} in the video
      </small>
    </article>
  );
}
