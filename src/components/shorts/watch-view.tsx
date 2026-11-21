"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Download, Eye, EyeOff, Maximize, Minimize, Pencil, Play, Sparkles, Trash2, Volume2, VolumeX } from "lucide-react";
import { Score, btn, btnGhost, btnPrimary, btnSm, formatTime } from "@/components/kit";
import { cn } from "@/lib/utils";
import { PLATFORMS, postKit, type CampaignRules, type Platform, type Short } from "./model";
import { QcBox } from "./qc";
import { Fold } from "@/components/ui/controls";

export type Tab = "post" | "why";
const TABS: [Tab, string, typeof Copy][] = [
  ["post", "Post kit", Copy],
  ["why", "Why this clip", Sparkles],
];

export type Frame = { url: string; t: number };

type Props = {
  jobId: string;
  short: Short;
  list: Short[];
  best: number;
  hidden: boolean;
  projectName: string;
  initialTab: Tab;
  /** Edits wait while the project is still making shorts. */
  locked: boolean;
  onEdit: (s: Short) => void;
  onGo: (id: string) => void;
  onBack: () => void;
  onHide: (id: string) => void;
  onCopy: (s: Short) => void;
  onDelete: (s: Short) => void;
  toast: (msg: string) => void;
  campaign?: CampaignRules;
  /** The short was made again or changed: reload the project. */
  onChanged: () => void;
};

export function WatchView(props: Props) {
  const { short, list, onGo, onBack, projectName } = props;
  const n = list.findIndex((s) => s.id === short.id);
  const prev = n > 0 ? list[n - 1] : null;
  const next = n >= 0 && n < list.length - 1 ? list[n + 1] : null;
  const [tab, setTab] = useState<Tab>(props.initialTab);
  const player = useRef<PlayerHandle>(null);

  function pick(t: Tab) {
    setTab(t);
    // Remember the tab in the address without a page jump, so a reload opens it again.
    history.replaceState(null, "", `#watch=${short.id}${t === "post" ? "" : `&tab=${t}`}`);
  }

  // Arrows flip through, space plays, Esc goes back to all shorts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select, button, a")) return;
      const k = e.key.toLowerCase();
      if (k === "arrowleft" && prev) onGo(prev.id);
      else if (k === "arrowright" && next) onGo(next.id);
      else if (k === "escape" && !document.fullscreenElement) onBack();
      else if (k === " ") player.current?.toggle();
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onGo, onBack]);

  const pager = "grid size-[34px] place-items-center rounded-[9px] text-muted-foreground hover:bg-raised hover:text-foreground disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-4";
  const others = list.filter((s) => s.id !== short.id);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="inline-flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4 shrink-0" aria-hidden="true" /> <span className="truncate">{projectName}</span>
        </button>
        <span className="flex shrink-0 items-center gap-2 text-[13px] text-muted-foreground">
          <button type="button" onClick={() => prev && onGo(prev.id)} disabled={!prev} aria-label="Previous short" className={pager}>
            <ChevronLeft aria-hidden="true" />
          </button>
          Short {n + 1} of {list.length}
          <button type="button" onClick={() => next && onGo(next.id)} disabled={!next} aria-label="Next short" className={pager}>
            <ChevronRight aria-hidden="true" />
          </button>
        </span>
      </div>

      <ShortBody key={short.file} {...props} tab={tab} onTab={pick} player={player} />

      {others.length > 0 && (
        <section className="mt-[38px]">
          <h2 className="mb-3 text-[17px] font-semibold">More shorts from this video</h2>
          <div className="flex gap-3 overflow-x-auto pb-1.5">
            {others.map((s) => (
              <button key={s.id} type="button" onClick={() => onGo(s.id)} className="group/more grid w-32 flex-none gap-1.5 text-left text-[13px] leading-[1.3] font-medium">
                <span className="relative block aspect-[9/16] overflow-hidden rounded-xl border bg-black group-hover/more:border-border-strong">
                  {/* eslint-disable-next-line @next/next/no-img-element -- poster served by our own route */}
                  <img src={s.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  <Score score={s.score} best={props.best} className="absolute top-1.5 left-1.5 px-2 text-[11px] [&_b]:text-[11px]" />
                </span>
                <span className="line-clamp-2">{s.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------------- one short: player, details, tabs ---------------- */

type BodyProps = Props & { tab: Tab; onTab: (t: Tab) => void; player: React.RefObject<PlayerHandle | null> };

function ShortBody({ player, ...p }: BodyProps) {
  const { short, best, hidden, tab } = p;
  return (
    <div className="grid items-start gap-[18px] lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-9">
      <Player ref={player} short={short} />

      <div className="min-w-0">
        <Score score={short.score} best={best} />
        <h1 className="mt-2 mb-1.5 text-[22px] leading-[1.15] font-[650] tracking-[-0.03em] lg:text-[28px]">{short.title}</h1>
        <p className="text-[13px] text-muted-foreground">
          {Math.round(short.durSec)} seconds, from {formatTime(short.startSec)} in the video{short.edits ? " · edited" : ""}
        </p>

        <div className="mt-[18px] mb-[22px] flex flex-wrap gap-2.5 max-lg:[&>*]:flex-1">
          <a href={short.videoUrl} download={short.downloadName} className={cn(btn, btnPrimary)}>
            <Download aria-hidden="true" /> Download
          </a>
          <button type="button" onClick={() => p.onEdit(short)} disabled={p.locked} title={p.locked ? "Editing opens once all shorts are made" : undefined} className={btn}>
            <Pencil aria-hidden="true" /> Edit
          </button>
          <button type="button" onClick={() => p.onCopy(short)} className={btn}>
            <Copy aria-hidden="true" /> Copy caption
          </button>
          <button type="button" onClick={() => p.onHide(short.id)} className={cn(btn, btnGhost, "max-lg:flex-none")}>
            {hidden ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
            {hidden ? "Show again" : "Hide"}
          </button>
          <button type="button" onClick={() => p.onDelete(short)} aria-label="Delete short" title="Delete short" className={cn(btn, btnGhost, "w-10 flex-none px-0 hover:text-bad")}>
            <Trash2 aria-hidden="true" />
          </button>
        </div>

        <QcBox jobId={p.jobId} short={short} onChanged={p.onChanged} toast={p.toast} />

        <div role="tablist" aria-label="About this short" className="mb-[18px] flex gap-[22px] border-b">
          {TABS.map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`tab-${k}`}
              aria-selected={tab === k}
              aria-controls="tab-panel"
              onClick={() => p.onTab(k)}
              className={cn("-mb-px inline-flex items-center gap-[7px] border-b-2 border-transparent py-2.5 font-semibold text-muted-foreground hover:text-foreground [&_svg]:size-4", tab === k && "border-moment text-foreground")}
            >
              <Icon aria-hidden="true" /> {label}
            </button>
          ))}
        </div>

        <div id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {tab === "post" && <PostKit short={short} campaign={p.campaign} toast={p.toast} />}
          {tab === "why" && <Why short={short} />}
        </div>
      </div>
    </div>
  );
}

/* ---------------- player ---------------- */

export type PlayerHandle = { toggle: () => void };

/** A plain vertical player: tap to play, a thin bar to seek, sound and full screen. Full screen stays vertical. */
export function Player({ short, ref }: { short: Short; ref?: React.Ref<PlayerHandle> }) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(short.durSec);
  const [muted, setMuted] = useState(false);
  const [full, setFull] = useState(false);

  const toggle = () => {
    const v = video.current;
    if (v) void (v.paused ? v.play() : v.pause());
  };
  useImperativeHandle(ref, () => ({ toggle }));

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function fullscreen() {
    if (document.fullscreenElement) return void document.exitFullscreen();
    const el = box.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (el?.requestFullscreen) void el.requestFullscreen();
    else v?.webkitEnterFullscreen?.(); // iPhone: the system player
  }

  const icon = "grid size-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm hover:bg-black/65 [&_svg]:size-[18px]";

  return (
    <div
      ref={box}
      className={cn(
        "group/player relative overflow-hidden bg-black",
        full ? "flex h-full w-full items-center justify-center" : "aspect-[9/16] w-[min(100%,360px)] rounded-[20px] border lg:h-[min(calc(100dvh-170px),760px)] lg:w-auto",
      )}
    >
      <video
        ref={video}
        src={short.videoUrl}
        poster={short.posterUrl}
        playsInline
        preload="metadata"
        aria-label={`Video: ${short.title}`}
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || short.durSec)}
        className={cn("block cursor-pointer", full ? "h-full max-h-screen w-auto object-contain" : "h-full w-full object-cover")}
      />
      {!playing && (
        <button type="button" onClick={toggle} aria-label="Play" className="absolute inset-0 grid place-items-center">
          <span className="grid size-[68px] place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <Play className="ml-1 size-7 fill-current" aria-hidden="true" />
          </span>
        </button>
      )}
      <div className={cn("absolute top-2.5 right-2.5 flex gap-1.5 opacity-0 transition-opacity group-hover/player:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100", !playing && "opacity-100")}>
        <button
          type="button"
          onClick={() => {
            const v = video.current;
            if (!v) return;
            v.muted = !v.muted;
            setMuted(v.muted);
          }}
          aria-label={muted ? "Unmute" : "Mute"}
          className={icon}
        >
          {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </button>
        <button type="button" onClick={fullscreen} aria-label={full ? "Exit full screen" : "Full screen"} className={icon}>
          {full ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
        </button>
      </div>
      {/* Thin seek bar along the bottom; the time shows while you hover. */}
      <div className={cn("absolute inset-x-0 bottom-0", full && "mx-auto max-w-[min(100vw,56.25vh)]")}>
        <span className="pointer-events-none absolute right-3 bottom-3 font-mono text-[11px] text-white/90 opacity-0 drop-shadow transition-opacity group-hover/player:opacity-100">
          {formatTime(time)} / {formatTime(dur)}
        </span>
        <input
          type="range"
          min={0}
          max={1000}
          value={dur ? Math.round((time / dur) * 1000) : 0}
          onChange={(e) => {
            const v = video.current;
            if (v && dur) v.currentTime = (Number(e.target.value) / 1000) * dur;
          }}
          aria-label="Seek"
          className="block h-1.5 w-full cursor-pointer appearance-none bg-white/25 accent-moment transition-[height] group-hover/player:h-3 [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-moment [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-moment"
          style={{ background: `linear-gradient(to right, var(--moment) ${dur ? (time / dur) * 100 : 0}%, rgb(255 255 255 / 0.25) 0)` }}
        />
      </div>
    </div>
  );
}

/* ---------------- post kit ---------------- */

function PostKit({ short, campaign, toast }: { short: Short; campaign?: CampaignRules; toast: (m: string) => void }) {
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [copied, setCopied] = useState<number | null>(null);
  const kit = postKit(short, campaign)[platform];

  async function copy(i: number) {
    try {
      await navigator.clipboard.writeText(kit[i][1]);
      setCopied(i);
      window.setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
    } catch {
      toast("Couldn't copy. Your browser blocked the clipboard.");
    }
  }

  return (
    <div className="grid gap-3.5">
      <div role="group" aria-label="Platform" className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-xl border bg-panel p-1">
        {PLATFORMS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={platform === k}
            onClick={() => {
              setPlatform(k);
              setCopied(null);
            }}
            className={cn("h-8 rounded-lg px-3 text-[13px] font-semibold text-muted-foreground hover:text-foreground", platform === k && "bg-raised text-foreground")}
          >
            {label}
          </button>
        ))}
      </div>
      {kit.map(([label, text], i) => (
        <div key={label} className="relative rounded-xl border bg-panel py-3 pr-[100px] pl-3.5">
          <small className="mb-[3px] block text-xs font-medium text-subtle">{label}</small>
          <p className="break-words whitespace-pre-wrap">{text}</p>
          <button type="button" onClick={() => copy(i)} className={cn(btn, btnSm, "absolute top-2.5 right-2.5")}>
            {copied === i ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copied === i ? "Copied" : "Copy"}
          </button>
        </div>
      ))}
      <p className="text-[13px] text-muted-foreground">Written by AI from what happens in the short. Change it after pasting if you like. Posting straight from here comes later.</p>
    </div>
  );
}

/* ---------------- why this clip ---------------- */

const SUB: [keyof Short["sub"], string][] = [
  ["hook", "Grabs attention fast"],
  ["action", "Action on screen"],
  ["reaction", "Your reaction"],
  ["clarity", "Makes sense on its own"],
];

function Why({ short }: { short: Short }) {
  return (
    <div className="grid gap-3.5">
      <div className="rounded-xl border bg-panel px-4 py-3.5">
        <p className="mb-3 text-[15px] text-muted-foreground">{short.reason}</p>
        <div className="grid gap-x-[18px] gap-y-2.5 sm:grid-cols-2">
          {SUB.map(([k, label]) => {
            const v = short.sub?.[k];
            return (
              <div key={k} className="grid grid-cols-[1fr_auto] gap-1 text-[13px] text-muted-foreground">
                <span>{label}</span>
                <b className="font-mono text-[13px] font-semibold text-foreground">{v ?? "–"}</b>
                <i className="col-span-2 block h-1 overflow-hidden rounded bg-raised" aria-hidden="true">
                  <em className="block h-full bg-foreground" style={{ width: `${v ?? 0}%` }} />
                </i>
              </div>
            );
          })}
        </div>
      </div>
      <Fold title="What was said in this short">
        <p className="max-w-[65ch] text-[13px] text-muted-foreground italic">&ldquo;{short.words}&rdquo;</p>
      </Fold>
    </div>
  );
}

