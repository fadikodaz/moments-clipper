"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Clock, FileVideo, LoaderCircle, RotateCcw, Upload, X } from "lucide-react";
import { Score, btn, btnGhost, btnPrimary, btnSm, formatTime } from "@/components/kit";
import type { EngineClip } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import type { JobResponse } from "./job-view";

type Props = {
  jobId: string;
  job: JobResponse;
  onOpen: (clipId?: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  busy: boolean;
};

const FLAT = Array.from({ length: 160 }, () => 0.16);

function timeLeft(started: number | undefined, progress: number) {
  if (!started || progress < 0.04) return "Working out the time left";
  const elapsed = Date.now() / 1000 - started;
  const left = (elapsed * (1 - progress)) / progress;
  return left >= 90 ? `About ${Math.round(left / 60)} min left` : left > 20 ? "About a minute left" : "Almost done";
}

/** The whole video as a waveform: it fills while the audio arrives, a line scans while we listen, moments light up as shorts finish. */
export function ProgressView({ jobId, job, onOpen, onCancel, onRetry, busy }: Props) {
  const { meta, status, result, timeline } = job;
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const clips = result?.clips ?? [];
  const state = status.state;
  const running = state === "running" || state === "queued";
  const done = state === "done";
  const stopped = state === "failed" || state === "cancelled";
  const step = status.step;
  const part = status.part ?? 0;
  const pct = Math.round((done ? 1 : status.progress) * 100);
  const link = meta.source === "youtube";
  const duration = timeline?.durationSec ?? result?.durationSec ?? meta.durationSec ?? 0;

  const bars = timeline?.bars ?? FLAT;
  const got = step > 1 || done ? 1 : step === 1 ? part : 0;
  const heard = step > 2 || done ? 1 : step === 2 ? part : 0;
  const moments = timeline?.moments ?? [];
  const isReady = (m: { id?: string; start: number }) => clips.some((c) => c.id === m.id || Math.abs(c.startSec - m.start) < 1);
  const expected = result?.expected ?? (step === 5 ? moments.length : 0);
  const making = running && step === 5 ? moments.filter((m) => m.id && !isReady(m)).sort((a, b) => (a.id! < b.id! ? -1 : 1))[0] : undefined;

  // Plain words for what is happening right now.
  let title = "Getting ready";
  let note = "";
  if (done) {
    title = `${clips.length} short${clips.length === 1 ? "" : "s"} ready`;
    note = "Click any orange mark to jump to that short.";
  } else if (state === "cancelled") {
    title = "Stopped";
    note = clips.length ? "Finished shorts are kept in the project." : "You stopped this before any shorts were finished.";
  } else if (state === "failed") {
    title = "This one didn't finish";
    note = status.error ?? "Something went wrong while making the shorts.";
  } else if (step === 1) {
    title = link ? "Getting the audio" : "Reading the audio";
    note = link ? "Only the sound, not the whole video" : "Pulling the sound out of your recording";
    if (status.detail.startsWith("YouTube refused")) note = status.detail;
  } else if (step === 2 || step === 3) {
    title = "Listening to the stream";
    note = "Turning what was said into text";
  } else if (step === 4) {
    title = moments.length ? `Found ${moments.length} great moment${moments.length === 1 ? "" : "s"}` : "Finding the best moments";
    note = "Picking reactions, fails and big plays";
  } else if (step === 5) {
    title = expected ? `Making short ${Math.min(clips.length + 1, expected)} of ${expected}` : "Making your shorts";
    note = clips.length ? "Finished shorts are below, watch them now" : status.detail && !/ready$/.test(status.detail) ? status.detail : "Cutting vertical and adding captions";
  }

  useEffect(() => {
    document.title = done ? `✓ ${clips.length} shorts ready | Moments` : running ? `${pct}% | Making shorts` : `${meta.name} | Moments`;
  }, [done, running, pct, clips.length, meta.name]);

  const pos = (sec: number) => `${duration ? (sec / duration) * 100 : 0}%`;
  const readyClips = [...clips].sort((a, b) => a.startSec - b.startSec);

  return (
    <div className="mx-auto max-w-[1180px] px-3.5 pt-[18px] pb-[130px] md:px-8 md:pt-8 md:pb-[120px]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {meta.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnail, shown as-is
            <img src={meta.thumbnail} alt="" className="aspect-video w-[60px] shrink-0 rounded-lg object-cover md:w-[76px]" />
          ) : (
            <span className="grid aspect-video w-[60px] shrink-0 place-items-center rounded-lg bg-raised text-subtle md:w-[76px]">
              <FileVideo className="size-5" strokeWidth={1.75} aria-hidden="true" />
            </span>
          )}
          <span className="min-w-0">
            <b className="block truncate text-sm font-semibold">{meta.name}</b>
            <small className="text-xs text-muted-foreground">
              {link ? "From YouTube" : "Uploaded file"}
              {duration ? `, ${formatTime(duration)}` : ""}
            </small>
          </span>
        </div>
        {running && (
          <button type="button" onClick={onCancel} disabled={busy} className={cn(btn, btnSm, btnGhost)}>
            <X aria-hidden="true" /> Cancel
          </button>
        )}
      </div>

      <section aria-live="polite" className="mt-[30px] mb-7 md:mt-[54px]">
        <h1 className="min-h-[1.1em] text-[clamp(30px,4.2vw,50px)] leading-[1.04] font-[650] tracking-[-0.045em]">{title}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-[18px] gap-y-1 text-base text-muted-foreground">
          {running && <span className="font-mono font-semibold text-foreground">{pct}%</span>}
          {running && (
            <span className="inline-flex items-center gap-[7px]">
              <Clock className="size-[18px]" aria-hidden="true" />
              {timeLeft(status.started, status.progress)}
            </span>
          )}
          {note && <span>{note}</span>}
        </p>
      </section>

      <section aria-label="Your video, start to end" className="relative pt-7 pb-[30px]">
        <div className="relative flex h-20 items-center gap-px md:h-[120px] md:gap-0.5">
          {bars.map((h, i) => {
            const at = (i + 0.5) / bars.length;
            return (
              <i
                key={i}
                style={{ height: `${Math.min(100, h * 100)}%` }}
                className={cn(
                  "flex-1 rounded-[2px] bg-border-strong opacity-[0.12] transition-[opacity,background-color,height] duration-300",
                  at <= got && "opacity-100",
                  at <= heard && "bg-[#6b6e76]",
                )}
              />
            );
          })}
        </div>
        {running && step === 2 && (
          <span
            aria-hidden="true"
            className="absolute top-[18px] bottom-[22px] w-0.5 rounded-[2px] bg-foreground shadow-[0_0_18px_rgb(244_244_245/0.6)] transition-[left] duration-700"
            style={{ left: `${heard * 100}%` }}
          />
        )}
        {duration > 0 &&
          moments.map((m, i) => {
            const ready = isReady(m);
            const clip = ready ? clips.find((c) => c.id === m.id || Math.abs(c.startSec - m.start) < 1) : undefined;
            return (
              <button
                key={`${m.start}-${i}`}
                type="button"
                disabled={!clip}
                onClick={() => clip && onOpen(clip.id)}
                aria-label={`${m.title ?? "Moment"} at ${formatTime(m.start)}`}
                className={cn(
                  "group/m absolute top-5 h-24 min-w-2.5 origin-bottom animate-grow rounded-md border-[1.5px] border-moment bg-moment/8 md:h-[136px]",
                  ready && "cursor-pointer bg-moment shadow-[0_0_24px_rgb(255_116_72/0.45)]",
                  making === m && "animate-pulse-moment",
                )}
                style={{ left: pos(m.start), width: `max(10px, ${duration ? ((m.end - m.start) / duration) * 100 : 0}%)` }}
              >
                {m.score != null && (
                  <b className={cn("absolute bottom-[calc(100%+6px)] left-1/2 hidden -translate-x-1/2 font-mono text-[11px] font-semibold whitespace-nowrap md:block", ready ? "text-foreground" : "text-moment")}>
                    {m.score}
                  </b>
                )}
                <em className="pointer-events-none absolute top-[calc(100%+8px)] left-1/2 z-[5] w-[180px] -translate-x-1/2 rounded-[10px] border border-border-strong bg-raised px-2.5 py-2 text-center text-xs text-foreground not-italic opacity-0 transition-opacity group-hover/m:opacity-100">
                  {m.title}
                  <br />
                  <span className="text-subtle">{formatTime(m.start)}</span>
                </em>
              </button>
            );
          })}
        <div className="mt-3 flex justify-between font-mono text-[11px] font-medium text-subtle">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <span key={f}>{duration ? formatTime(duration * f) : f === 0 ? "0:00" : ""}</span>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-5 text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <i className="size-3.5 rounded bg-[#6b6e76]" />
          Listened to
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="size-3.5 rounded border-[1.5px] border-moment" />
          Moment found
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="size-3.5 rounded bg-moment" />
          Short ready
        </span>
      </div>

      {done && (
        <div className="mt-[30px] flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-moment/35 bg-moment-soft px-5 py-[18px]">
          <span>
            <b className="text-base">All done.</b> <span className="text-muted-foreground">Watch them, then download the ones you like.</span>
          </span>
          <button type="button" onClick={() => onOpen()} className={cn(btn, btnPrimary)}>
            Open project <ChevronRight aria-hidden="true" />
          </button>
        </div>
      )}

      {stopped && (
        <div role="alert" className="mt-[30px] rounded-2xl border border-bad/35 bg-bad/8 p-5">
          <b className="mb-1 block text-[17px]">What you can do</b>
          <p className="mb-3.5 text-muted-foreground">
            {state === "cancelled"
              ? "Start again with the same video and choices whenever you like."
              : link
                ? "Try again in a few minutes. If it keeps happening, download the video yourself and upload the file."
                : "Try again. If it keeps happening, try a different file."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onRetry} disabled={busy} className={cn(btn, btnPrimary)}>
              {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
              {state === "cancelled" ? "Start again" : "Try again"}
            </button>
            {link && (
              <Link href="/" className={cn(btn, btnGhost)}>
                <Upload aria-hidden="true" /> Upload the file instead
              </Link>
            )}
            {clips.length > 0 && (
              <button type="button" onClick={() => onOpen()} className={cn(btn, btnGhost)}>
                See the {clips.length} finished short{clips.length === 1 ? "" : "s"}
              </button>
            )}
          </div>
        </div>
      )}

      {(readyClips.length > 0 || making) && (
        <>
          <h2 className="mt-11 mb-3.5 text-lg font-semibold tracking-[-0.02em]">Your shorts</h2>
          <div className="grid grid-cols-2 gap-x-3.5 gap-y-[18px] sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
            {readyClips.map((c) => (
              <ReadyCard key={c.id} jobId={jobId} clip={c} best={Math.max(...clips.map((x) => x.score))} onOpen={() => onOpen(c.id)} />
            ))}
            {making && (
              <div className="grid animate-rise gap-2">
                <span className="grid aspect-[9/16] animate-shine place-items-center rounded-[14px] border bg-[linear-gradient(100deg,var(--panel)_30%,var(--raised)_50%,var(--panel)_70%)] bg-[length:300%_100%] text-xs text-subtle">
                  Making…
                </span>
                <b className="text-sm leading-[1.3] font-medium text-subtle">{making.title}</b>
              </div>
            )}
          </div>
        </>
      )}

      {running && <p className="mt-11 text-xs text-subtle">This keeps going if you close the page. Come back any time from Projects.</p>}
    </div>
  );
}

function ReadyCard({ jobId, clip, best, onOpen }: { jobId: string; clip: EngineClip; best: number; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="grid animate-rise content-start gap-2 text-left">
      <span className="relative block aspect-[9/16] overflow-hidden rounded-[14px] border bg-raised hover:border-border-strong">
        {/* eslint-disable-next-line @next/next/no-img-element -- poster served by our own route */}
        <img src={`/api/jobs/${jobId}/files/${clip.poster}`} alt="" className="h-full w-full object-cover" />
        <Score score={clip.score} best={best} className="absolute top-2 left-2" />
      </span>
      <b className="text-sm leading-[1.3] font-semibold">{clip.title}</b>
    </button>
  );
}
