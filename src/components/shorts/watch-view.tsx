"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Copy,
  Download,
  Eye,
  EyeOff,
  LoaderCircle,
  Maximize,
  Minimize,
  Play,
  Scissors,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Score, api, btn, btnCta, btnGhost, btnPrimary, btnSm, field, formatTime } from "@/components/kit";
import { CaptionControls, ExtraControls, HookControls, LayoutControls } from "@/components/setup/controls";
import { FrameEditor } from "@/components/setup/frame-editor";
import { PhonePreview } from "@/components/setup/phone-preview";
import { DEFAULT_STYLE, usesCam, withDefaults, type Box, type Style } from "@/components/setup/style";
import type { RemakeAllStatus, RemakeEdits, RemakeStatus, ShortLayout } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { PLATFORMS, captionLines, postKit, type CampaignRules, type Platform, type Short } from "./model";

export type Tab = "post" | "edit" | "why";
const TABS: [Tab, string, typeof Copy][] = [
  ["post", "Post kit", Copy],
  ["edit", "Edit", Scissors],
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
  /** Seconds in the whole video, so a short can't be stretched past its end. */
  videoSec: number;
  canFacecam: boolean;
  defaultCaptions: RemakeEdits["captions"];
  /** Pictures of the source video (from the set-up screen) and the facecam found in it. */
  frames: Frame[];
  detected: Box | null;
  /** Edits wait while the project is still making shorts. */
  locked: boolean;
  onGo: (id: string) => void;
  onBack: () => void;
  onHide: (id: string) => void;
  onCopy: (s: Short) => void;
  onDelete: (s: Short) => void;
  onChanged: () => void;
  toast: (msg: string) => void;
  campaign?: CampaignRules;
};

export function WatchView(props: Props) {
  const { short, list, onGo, onBack, projectName } = props;
  const n = list.findIndex((s) => s.id === short.id);
  const prev = n > 0 ? list[n - 1] : null;
  const next = n >= 0 && n < list.length - 1 ? list[n + 1] : null;
  const [tab, setTab] = useState<Tab>(props.initialTab);
  const [updated, setUpdated] = useState(false);
  const player = useRef<PlayerHandle>(null);
  const { onChanged } = props;
  const done = useCallback(() => {
    setUpdated(true);
    onChanged();
  }, [onChanged]);

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

      <ShortBody key={short.file} {...props} tab={tab} onTab={pick} updated={updated} onUpdated={setUpdated} onDone={done} player={player} />

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

/* ---------------- one short: player or live preview, details, tabs ---------------- */

/** This short's look; older shorts only knew a layout and a caption style. */
function lookOf(short: Short, canFacecam: boolean, defaultCaptions: RemakeEdits["captions"]): Style {
  if (short.style) return withDefaults(short.style);
  const layout: ShortLayout = short.layout ?? (canFacecam ? "facecam" : "gameplay");
  const caps = short.captions ?? defaultCaptions;
  return withDefaults({
    layout: layout === "facecam" ? "top" : layout === "gameplay" ? "game" : "full",
    captions: { ...DEFAULT_STYLE.captions, style: caps === "bold" ? "word" : caps === "simple" ? "box" : "none", font: "Arial Black", size: 25, hl: "#ff7448", y: 68, words: 4, censor: false },
    hook: { on: true, style: "white", sec: 3.5 },
    flash: false,
    zoom: false,
    progress: false,
  });
}

/** Everything the Edit tab changes, kept here so the live preview on the left shows it too. */
export type Draft = {
  sd: number;
  ed: number;
  hook: string;
  look: Style;
  texts: string[];
};

type BodyProps = Props & {
  tab: Tab;
  onTab: (t: Tab) => void;
  updated: boolean;
  onUpdated: (v: boolean) => void;
  onDone: () => void;
  player: React.RefObject<PlayerHandle | null>;
};

function ShortBody({ player, ...p }: BodyProps) {
  const { short, best, hidden, tab } = p;
  const origLook = lookOf(short, p.canFacecam, p.defaultCaptions);
  const [draft, setDraft] = useState<Draft>(() => ({ sd: 0, ed: 0, hook: short.hook ?? "", look: origLook, texts: captionLines(short).map((l) => l.text) }));
  const [view, setView] = useState<"preview" | "video">("preview");
  // A picture of this short's own moment (saved while cutting); older shorts use the closest set-up picture.
  const mid = short.startSec + short.durSec / 2;
  const frame = short.frameUrl ? { url: short.frameUrl, t: mid } : p.frames.length ? p.frames.reduce((a, b) => (Math.abs(b.t - mid) < Math.abs(a.t - mid) ? b : a)) : null;
  const previewing = tab === "edit" && !!frame && view === "preview";
  const setLook = useCallback((fn: (s: Style) => Style) => setDraft((d) => ({ ...d, look: fn(d.look) })), [setDraft]);

  return (
    <div className="grid items-start gap-[18px] lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-9">
      <div className="grid justify-items-center gap-2.5 lg:sticky lg:top-6">
        {tab === "edit" && frame && (
          <div role="group" aria-label="Show" className="inline-flex gap-0.5 rounded-[11px] border bg-panel p-[3px]">
            {(
              [
                ["preview", "Preview changes"],
                ["video", "Current video"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={cn("h-8 rounded-lg px-3 text-[13px] font-medium text-muted-foreground", view === k && "bg-raised text-foreground shadow-[0_0_0_1px_var(--border-strong)]")}>
                {l}
              </button>
            ))}
          </div>
        )}
        {previewing ? (
          <>
            <PhonePreview
              style={draft.look}
              frame={frame.url}
              cam={draft.look.nocam ? null : p.detected}
              hook={draft.hook}
              onCaptionY={(y) => setLook((s) => ({ ...s, captions: { ...s.captions, y } }))}
            />
            <p className="max-w-[288px] text-center text-xs text-muted-foreground">Drag the captions up or down. The real short updates when you save.</p>
          </>
        ) : (
          <Player ref={player} short={short} />
        )}
      </div>

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
          {tab === "edit" && (
            <EditPanel
              jobId={p.jobId}
              short={short}
              videoSec={p.videoSec}
              canFacecam={p.canFacecam}
              origLook={origLook}
              draft={draft}
              setDraft={setDraft}
              setLook={setLook}
              frames={p.frames}
              detected={p.detected}
              locked={p.locked}
              updated={p.updated}
              onDone={p.onDone}
              onEditMore={() => p.onUpdated(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- player ---------------- */

type PlayerHandle = { toggle: () => void };

/** A plain vertical player: tap to play, a thin bar to seek, sound and full screen. Full screen stays vertical. */
function Player({ short, ref }: { short: Short; ref: React.Ref<PlayerHandle> }) {
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
      <details>
        <summary className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground">What was said in this short</summary>
        <p className="mt-2 max-w-[65ch] text-[13px] text-muted-foreground italic">&ldquo;{short.words}&rdquo;</p>
      </details>
    </div>
  );
}

/* ---------------- edit ---------------- */

const SHIFT = 15;
/** Wall-clock time for progress bars, read only in event handlers. */
const clock = () => Date.now();

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-panel p-4">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {sub && <p className="mt-0.5 mb-3.5 text-[13px] text-muted-foreground">{sub}</p>}
      {!sub && <div className="h-3" />}
      {children}
    </section>
  );
}

type EditProps = {
  jobId: string;
  short: Short;
  videoSec: number;
  canFacecam: boolean;
  origLook: Style;
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  setLook: (fn: (s: Style) => Style) => void;
  frames: Frame[];
  detected: Box | null;
  locked: boolean;
  updated: boolean;
  onDone: () => void;
  onEditMore: () => void;
};

function EditPanel({ jobId, short, videoSec, canFacecam, origLook, draft, setDraft, setLook, frames, detected, locked, updated, onDone, onEditMore }: EditProps) {
  const lines = captionLines(short);
  const { sd, ed, hook, look, texts } = draft;
  const [all, setAll] = useState<RemakeAllStatus | null>(null);
  const [job, setJob] = useState<RemakeStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [frameIndex, setFrameIndex] = useState(0);

  const url = `/api/jobs/${jobId}/clips/${short.id}/remake`;
  const running = job?.state === "running";

  // A remake may already be going (the page was reloaded meanwhile).
  useEffect(() => {
    let stop = false;
    api<RemakeStatus | null>(url, { cache: "no-store" })
      .then((s) => !stop && s?.state === "running" && setJob(s))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [url]);

  // Follow a running remake until it ends.
  useEffect(() => {
    if (!running) return;
    let stop = false;
    let timer: number | undefined;
    async function poll() {
      try {
        const s = await api<RemakeStatus | null>(url, { cache: "no-store" });
        if (stop) return;
        if (s?.state === "running") {
          timer = window.setTimeout(poll, 2000);
          return;
        }
        setJob(s);
        if (s?.state === "done") onDone();
      } catch {
        if (!stop) timer = window.setTimeout(poll, 3000);
      }
    }
    timer = window.setTimeout(poll, 2000);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [running, url, onDone]);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [running]);

  // "Apply to all": follow progress until every short is made again.
  useEffect(() => {
    if (all?.state !== "running") return;
    const t = window.setInterval(async () => {
      try {
        const s = await api<RemakeAllStatus | null>(`/api/jobs/${jobId}/remake-all`, { cache: "no-store" });
        if (s) setAll(s);
        if (s && s.state !== "running") onDone();
      } catch {
        // keep polling
      }
    }, 2500);
    return () => window.clearInterval(t);
  }, [all?.state, jobId, onDone]);

  const minSd = Math.max(-SHIFT, -Math.floor(short.startSec));
  const maxEd = Math.min(SHIFT, Math.floor(videoSec - short.startSec - short.durSec));
  const newLen = short.durSec - sd + ed;
  const changedLines = lines.flatMap((l, i) => (texts[i].trim().replace(/\s+/g, " ") !== l.text ? [{ from: l.from, to: l.to, text: texts[i].trim() }] : []));
  const lookChanged = JSON.stringify(look) !== JSON.stringify(origLook);
  const dirty = sd !== 0 || ed !== 0 || hook.trim() !== (short.hook ?? "").trim() || lookChanged || changedLines.length > 0;
  const tooShort = newLen < 5;
  const hasCam = canFacecam || !!look.cam;

  // The lane shows 15 seconds either side of the short; the orange box is what will be kept.
  const window_ = short.durSec + SHIFT * 2;
  const keepL = ((SHIFT + sd) / window_) * 100;
  const keepW = ((short.durSec - sd + ed) / window_) * 100;
  const signed = (v: number) => `${v > 0 ? "+" : ""}${v} s`;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  async function applyAll() {
    if (!confirm("Make every short of this video again with this look? Each keeps its own start, end and words. It takes about 40 seconds per short.")) return;
    try {
      await api(`/api/jobs/${jobId}/remake-all`, { method: "POST", json: { style: look } });
      setAll({ state: "running", done: 0, total: 0 });
    } catch (e) {
      setAll({ state: "failed", done: 0, total: 0, error: (e as Error).message });
    }
  }

  async function save() {
    const edits: RemakeEdits = { startDelta: sd, endDelta: ed, hook: hook.trim(), layout: "facecam", captions: "bold", lines: changedLines, style: look };
    try {
      await api(url, { method: "POST", json: edits });
      setJob({ state: "running", error: null, started: clock() / 1000 });
      setNow(clock());
    } catch (e) {
      setJob({ state: "failed", error: (e as Error).message });
    }
  }

  const label = "mb-1.5 block text-xs font-medium text-muted-foreground";
  const elapsed = job?.started ? now / 1000 - job.started : 0;

  return (
    <div className="grid gap-3.5">
      {locked && <p className="rounded-xl border bg-panel px-3.5 py-2.5 text-[13px] text-muted-foreground">Editing opens once all shorts of this video are made. This page updates by itself.</p>}

      <fieldset disabled={locked || running} className="grid gap-3.5 disabled:opacity-60">
        <Section title="Start and end" sub="Move the start or the end by up to 15 seconds.">
          <div className="relative h-12 overflow-hidden rounded-[10px] bg-[repeating-linear-gradient(90deg,var(--color-raised)_0_6px,var(--color-hover)_6px_9px)]" aria-hidden="true">
            <span className="absolute inset-y-0 rounded-[10px] border-2 border-moment bg-moment/10" style={{ left: `${keepL}%`, width: `${keepW}%` }} />
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-3">
            <label>
              <span className="flex justify-between text-xs text-muted-foreground">
                <span>Start earlier or later</span>
                <b className="font-mono text-foreground">{signed(sd)}</b>
              </span>
              <input type="range" min={minSd} max={SHIFT} value={sd} onChange={(e) => set("sd", Number(e.target.value))} className="w-full accent-moment" />
            </label>
            <label>
              <span className="flex justify-between text-xs text-muted-foreground">
                <span>End earlier or later</span>
                <b className="font-mono text-foreground">{signed(ed)}</b>
              </span>
              <input type="range" min={-SHIFT} max={Math.max(0, maxEd)} value={ed} onChange={(e) => set("ed", Number(e.target.value))} className="w-full accent-moment" />
            </label>
          </div>
          <p className={cn("mt-1 text-xs", tooShort ? "text-bad" : "text-subtle")}>
            {tooShort ? "Too short: a short needs at least 5 seconds." : `From ${formatTime(short.startSec + sd)} to ${formatTime(short.startSec + short.durSec + ed)} in the video, ${Math.round(newLen)} seconds.`}
          </p>
        </Section>

        <Section title="Captions" sub="How the words look and where they sit. Drag them on the preview, or use Height on screen.">
          <CaptionControls style={look} set={setLook} />
          {lines.length > 0 && look.captions.style !== "none" && (
            <div className="mt-4">
              <span className={label}>Fix caption words</span>
              <div className="grid max-h-[240px] gap-1.5 overflow-y-auto pr-1">
                {lines.map((l, i) => (
                  <label key={l.from} className="grid grid-cols-[52px_1fr] items-center gap-2.5 font-mono text-xs font-medium text-subtle">
                    {formatTime(l.at)}
                    <input
                      value={texts[i]}
                      onChange={(e) => set("texts", texts.map((x, k) => (k === i ? e.target.value : x)))}
                      aria-label={`Caption line ${i + 1}`}
                      className={cn(field, "font-sans text-sm text-foreground")}
                    />
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-subtle">Moving the start or end keeps your fixed words. New seconds get fresh captions.</p>
            </div>
          )}
        </Section>

        <Section title="Opening line" sub="The line shown for the first seconds.">
          <input value={hook} onChange={(e) => set("hook", e.target.value)} maxLength={60} placeholder="No opening line" aria-label="Opening line" className={cn(field, "mb-3")} />
          <HookControls style={look} set={setLook} />
        </Section>

        <Section title="Layout and facecam" sub="Where the facecam and the gameplay go.">
          <LayoutControls style={look} set={setLook} hasCam={hasCam} />
          {usesCam(look) && (short.frameUrl || frames.length > 0) && (
            <div className="mt-4">
              <span className={label}>Facecam box: drag it to move, drag a corner to resize</span>
              <FrameEditor frames={short.frameUrl ? [{ url: short.frameUrl, t: short.startSec }, ...frames] : frames} index={frameIndex} onIndex={setFrameIndex} detected={detected} style={look} set={setLook} />
            </div>
          )}
        </Section>

        <Section title="Extras">
          <ExtraControls style={look} set={setLook} />
        </Section>
      </fieldset>

      <div className="sticky bottom-[72px] z-20 grid gap-2.5 rounded-2xl border border-border-strong bg-raised/95 px-4 py-3.5 shadow-[0_20px_60px_rgb(0_0_0/0.5)] backdrop-blur md:bottom-3.5" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {running ? (
            <div className="flex-1">
              <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin text-moment" aria-hidden="true" /> Making the short again with your changes…
              </span>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-hover">
                <i className="block h-full bg-moment transition-[width] duration-500 ease-linear" style={{ width: `${Math.min(95, (elapsed / 45) * 100)}%` }} />
              </div>
            </div>
          ) : job?.state === "done" ? (
            <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Loading the new version…
            </span>
          ) : updated && !dirty ? (
            <>
              <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <CircleCheck className="size-4 text-good" aria-hidden="true" /> Updated. Press play to see it.
              </span>
              <button type="button" onClick={onEditMore} className={cn(btn, btnSm)}>
                Edit more
              </button>
            </>
          ) : (
            <>
              <span className={cn("flex items-center gap-2 text-[13px]", job?.state === "failed" ? "text-bad" : "text-muted-foreground")}>
                {job?.state === "failed" ? (
                  <>
                    <CircleAlert className="size-4 shrink-0" aria-hidden="true" /> {job.error}
                  </>
                ) : dirty ? (
                  "Captions and layout are part of the video, so the short is made again (under a minute)."
                ) : (
                  "Change anything above, then save."
                )}
              </span>
              <button type="button" onClick={save} disabled={!dirty || tooShort || locked} className={cn(btn, btnCta)}>
                {job?.state === "failed" ? "Try again" : "Save and remake"}
              </button>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
          <span className="text-xs text-muted-foreground">
            {all?.state === "running"
              ? `Giving every short this look: ${all.done} of ${all.total || "…"} done`
              : all?.state === "failed"
                ? all.error
                : all?.state === "done"
                  ? "Every short now has this look."
                  : "Like this look? Give it to every short of this video (keeps each one's own timing and words)."}
          </span>
          <button type="button" onClick={applyAll} disabled={locked || running || all?.state === "running"} className={cn(btn, btnSm, btnGhost)}>
            {all?.state === "running" && <LoaderCircle className="animate-spin" aria-hidden="true" />} Apply look to all
          </button>
        </div>
      </div>
    </div>
  );
}
