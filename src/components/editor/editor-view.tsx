"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, CircleAlert, LoaderCircle } from "lucide-react";
import { Toast, api, btn, btnCta, btnGhost, field, formatTime, useToast } from "@/components/kit";
import { FrameEditor } from "@/components/setup/frame-editor";
import { PhonePreview, type Part } from "@/components/setup/phone-preview";
import { DEFAULT_STYLE, usesCam, withDefaults, type Box, type Style } from "@/components/setup/style";
import { captionLines, type CampaignRules, type Short } from "@/components/shorts/model";
import { Player, type Frame } from "@/components/shorts/watch-view";
import type { RemakeAllStatus, RemakeEdits, RemakeStatus } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { Checkbox, Slider } from "@/components/ui/controls";
import { CaptionPanel, EffectsPanel, HookPanel, LayoutPanel, More, Panel, ToolBar, type ToolKey } from "./tools";

const SHIFT = 15;
/** Wall-clock time for progress bars, read only in event handlers. */
const clock = () => Date.now();

/** This short's look; older shorts only knew a layout and a caption style. */
export function lookOf(short: Short, canFacecam: boolean, defaultCaptions: RemakeEdits["captions"]): Style {
  if (short.style) return withDefaults(short.style);
  const layout = short.layout ?? (canFacecam ? "facecam" : "gameplay");
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

type Props = {
  jobId: string;
  short: Short;
  total: number;
  videoSec: number;
  canFacecam: boolean;
  defaultCaptions: RemakeEdits["captions"];
  frames: Frame[];
  detected: Box | null;
  locked: boolean;
  campaign?: CampaignRules & { streamer?: string };
  onBack: () => void;
  onChanged: () => void;
};

/** "Edit short": the short on the left, one tool at a time on the right, one save button. */
export function EditorView(props: Props) {
  // Remounts when the short is made again (new file), so everything starts from the new version.
  return <Editor key={props.short.file} {...props} />;
}

function Editor({ jobId, short, total, videoSec, canFacecam, defaultCaptions, frames, detected, locked, campaign, onBack, onChanged }: Props) {
  const orig = lookOf(short, canFacecam, defaultCaptions);
  const lines = captionLines(short);
  const [look, setLook] = useState<Style>(orig);
  const [hook, setHook] = useState(short.hook ?? "");
  const [sd, setSd] = useState(0);
  const [ed, setEd] = useState(0);
  const [texts, setTexts] = useState(() => lines.map((l) => l.text));
  const [tool, setTool] = useState<ToolKey>("hook");
  const [sel, setSel] = useState<Part | null>("hook");
  const [view, setView] = useState<"preview" | "video">("preview");
  const [frameIndex, setFrameIndex] = useState(0);
  const [toAll, setToAll] = useState(false);
  const [job, setJob] = useState<RemakeStatus | null>(null);
  const [all, setAll] = useState<RemakeAllStatus | null>(null);
  const [pendingAll, setPendingAll] = useState(false);
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);
  const toast = useToast();

  const url = `/api/jobs/${jobId}/clips/${short.id}/remake`;
  const running = job?.state === "running";
  const allRunning = all?.state === "running";
  const who = campaign?.streamer || campaign?.mention?.split(" ")[0];
  const mid = short.startSec + short.durSec / 2;
  const frame = short.frameUrl ?? (frames.length ? frames.reduce((a, b) => (Math.abs(b.t - mid) < Math.abs(a.t - mid) ? b : a)).url : null);
  const camFrames: Frame[] = short.frameUrl ? [{ url: short.frameUrl, t: short.startSec }, ...frames] : frames;
  const set = useCallback((fn: (s: Style) => Style) => setLook(fn), []);

  // What changed, per tool (the dots) and in total.
  const sameLook = (keys: (keyof Style)[]) => keys.every((k) => JSON.stringify(look[k]) === JSON.stringify(orig[k]));
  const changedLines = lines.flatMap((l, i) => (texts[i].trim().replace(/\s+/g, " ") !== l.text ? [{ from: l.from, to: l.to, text: texts[i].trim() }] : []));
  const changed: Record<ToolKey, boolean> = {
    hook: !sameLook(["hook"]) || hook.trim() !== (short.hook ?? "").trim(),
    cap: !sameLook(["captions"]) || changedLines.length > 0,
    layout: !sameLook(["layout", "camPct", "gap", "gapStyle", "gapColor", "pipCorner", "pipSize", "focus", "cam", "nocam"]),
    time: sd !== 0 || ed !== 0,
    fx: !sameLook(["flash", "zoom", "progress"]),
  };
  const nChanges = Object.values(changed).filter(Boolean).length;
  const lookChanged = JSON.stringify(look) !== JSON.stringify(orig);
  const newLen = short.durSec - sd + ed;

  // A remake may already be going (the page was reloaded meanwhile).
  useEffect(() => {
    let stop = false;
    api<RemakeStatus | null>(url, { cache: "no-store" })
      .then((s) => !stop && s?.state === "running" && setJob(s))
      .catch(() => {});
    api<RemakeAllStatus | null>(`/api/jobs/${jobId}/remake-all`, { cache: "no-store" })
      .then((s) => !stop && s?.state === "running" && setAll(s))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [url, jobId]);

  // Follow this short's remake; then, if asked, give the other shorts the same look.
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
        if (s?.state === "done") {
          if (pendingAll) {
            try {
              await api(`/api/jobs/${jobId}/remake-all`, { method: "POST", json: { style: look, exclude: [short.id] } });
              setAll({ state: "running", done: 0, total: total - 1 });
            } catch (e) {
              toast.show((e as Error).message);
            }
            setPendingAll(false);
          }
          onChanged();
        }
      } catch {
        if (!stop) timer = window.setTimeout(poll, 3000);
      }
    }
    timer = window.setTimeout(poll, 2000);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [running, url, onChanged, pendingAll, jobId, look, short.id, total, toast]);

  useEffect(() => {
    if (!allRunning) return;
    const t = window.setInterval(async () => {
      try {
        const s = await api<RemakeAllStatus | null>(`/api/jobs/${jobId}/remake-all`, { cache: "no-store" });
        if (s) setAll(s);
        if (s && s.state !== "running") {
          toast.show(s.state === "done" ? "Every short now has this look." : (s.error ?? "Some shorts couldn't be made again."));
          onChanged();
        }
      } catch {
        // keep polling
      }
    }, 2500);
    return () => window.clearInterval(t);
  }, [allRunning, jobId, onChanged, toast]);

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(clock()), 500);
    return () => window.clearInterval(t);
  }, [running]);

  function pick(p: Part) {
    setSel(p);
    setTool(p === "hook" ? "hook" : p === "cap" ? "cap" : "layout");
  }

  function undo() {
    setLook(orig);
    setHook(short.hook ?? "");
    setSd(0);
    setEd(0);
    setTexts(lines.map((l) => l.text));
  }

  async function save() {
    const onlyLook = !changed.time && hook.trim() === (short.hook ?? "").trim() && changedLines.length === 0;
    try {
      if (toAll && onlyLook && lookChanged) {
        // Same look for every short, this one included: one job.
        await api(`/api/jobs/${jobId}/remake-all`, { method: "POST", json: { style: look } });
        setAll({ state: "running", done: 0, total });
        return;
      }
      const edits: RemakeEdits = { startDelta: sd, endDelta: ed, hook: hook.trim(), layout: "facecam", captions: "bold", lines: changedLines, style: look };
      await api(url, { method: "POST", json: edits });
      setPendingAll(toAll && lookChanged);
      setStarted(clock());
      setNow(clock());
      setJob({ state: "running", error: null });
    } catch (e) {
      setJob({ state: "failed", error: (e as Error).message });
    }
  }

  const hasCam = canFacecam || !!look.cam;
  const keepL = ((SHIFT + sd) / (short.durSec + SHIFT * 2)) * 100;
  const keepW = (newLen / (short.durSec + SHIFT * 2)) * 100;
  const signed = (v: number) => `${v > 0 ? "+" : ""}${v} s`;
  const busy = running || allRunning || job?.state === "done";

  return (
    <div className="mx-auto max-w-[1180px] px-3.5 pt-[18px] pb-[130px] md:px-8 md:pt-8 md:pb-[120px]">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden="true" /> Back to the short
      </button>
      <h1 className="mt-1 mb-[18px] text-xl leading-tight font-[650] tracking-[-0.02em]">Edit: {short.title}</h1>
      {locked && <p className="mb-4 rounded-xl border bg-panel px-3.5 py-2.5 text-[13px] text-muted-foreground">Editing opens once all shorts of this video are made. This page updates by itself.</p>}

      <div className="grid items-start gap-8 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="grid justify-items-center gap-2.5 lg:sticky lg:top-5">
          <div role="group" aria-label="Show" className="inline-flex gap-0.5 rounded-[11px] border bg-panel p-[3px]">
            {(
              [
                ["preview", "Preview"],
                ["video", "Current video"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={cn("h-8 rounded-lg px-3 text-[13px] font-medium text-muted-foreground", view === k && "bg-raised text-foreground shadow-[0_0_0_1px_var(--border-strong)]")}>
                {l}
              </button>
            ))}
          </div>
          {view === "preview" ? (
            <>
              <PhonePreview
                style={look}
                frame={frame}
                cam={look.nocam ? null : detected}
                hook={hook}
                width={320}
                selected={sel}
                onSelect={pick}
                onCaptionY={(y) => set((s) => ({ ...s, captions: { ...s.captions, y } }))}
                onHookY={(y) => set((s) => ({ ...s, hook: { ...s.hook, pos: "custom", y } }))}
              />
              <p className="max-w-[320px] text-center text-xs text-subtle">Click or drag on the short to change it.</p>
            </>
          ) : (
            <Player short={short} />
          )}
        </div>

        <div className="min-w-0">
          <ToolBar tools={["hook", "cap", "layout", "time", "fx"]} active={tool} onPick={(t) => { setTool(t); setSel(t === "hook" ? "hook" : t === "cap" ? "cap" : t === "layout" ? "cam" : null); }} changed={changed} />
          <fieldset disabled={locked || busy} className="min-w-0 disabled:opacity-60">
            {tool === "hook" && <HookPanel style={look} set={set} text={hook} onText={setHook} frame={frame} mention={campaign?.mention} />}
            {tool === "cap" && (
              <CaptionPanel
                style={look}
                set={set}
                frame={frame}
                who={who}
                extra={
                  lines.length > 0 && (
                    <More title="Fix wrong words">
                      <div className="grid max-h-[240px] gap-1.5 overflow-y-auto pr-1">
                        {lines.map((l, i) => (
                          <label key={l.from} className="grid grid-cols-[48px_1fr] items-center gap-2.5 font-mono text-xs font-medium text-subtle">
                            {formatTime(l.at)}
                            <input value={texts[i]} onChange={(e) => setTexts((t) => t.map((x, k) => (k === i ? e.target.value : x)))} aria-label={`Caption line ${i + 1}`} className={cn(field, "font-sans text-sm text-foreground")} />
                          </label>
                        ))}
                      </div>
                    </More>
                  )
                }
              />
            )}
            {tool === "layout" && (
              <LayoutPanel
                style={look}
                set={set}
                hasCam={hasCam}
                who={who}
                camEditor={
                  usesCam(look) &&
                  camFrames.length > 0 && (
                    <More title="Adjust the facecam box">
                      <FrameEditor frames={camFrames} index={frameIndex} onIndex={setFrameIndex} detected={detected} style={look} set={set} />
                    </More>
                  )
                }
              />
            )}
            {tool === "time" && (
              <Panel title="Timing" lead="Start a bit earlier or later, or end sooner. Up to 15 seconds either way.">
                <div className="relative h-[46px] overflow-hidden rounded-[10px] bg-[repeating-linear-gradient(90deg,var(--color-raised)_0_6px,var(--color-hover)_6px_9px)]" aria-hidden="true">
                  <span className="absolute inset-y-0 rounded-[10px] border-2 border-moment bg-moment/10" style={{ left: `${keepL}%`, width: `${keepW}%` }} />
                </div>
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <Slider label="Start" value={sd} shown={signed(sd)} min={Math.max(-SHIFT, -Math.floor(short.startSec))} max={SHIFT} onChange={setSd} />
                  <Slider label="End" value={ed} shown={signed(ed)} min={-SHIFT} max={Math.max(0, Math.min(SHIFT, Math.floor(videoSec - short.startSec - short.durSec)))} onChange={setEd} />
                </div>
                <p className={cn("text-[13px]", newLen < 5 ? "text-bad" : "text-muted-foreground")}>
                  {newLen < 5 ? "Too short: a short needs at least 5 seconds." : `From ${formatTime(short.startSec + sd)} in the video, ${Math.round(newLen)} seconds long.`}
                </p>
              </Panel>
            )}
            {tool === "fx" && <EffectsPanel style={look} set={set} noLogos={!!campaign} />}
          </fieldset>

          <div className="sticky bottom-[72px] z-20 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-strong bg-raised/95 py-3 pr-3 pl-[18px] shadow-[0_20px_60px_rgb(0_0_0/0.55)] backdrop-blur md:bottom-3.5" aria-live="polite">
            {running || job?.state === "done" ? (
              <div className="grid flex-1 gap-1.5">
                <b className="flex items-center gap-2 text-sm">
                  <LoaderCircle className="size-4 animate-spin text-moment" aria-hidden="true" />
                  {job?.state === "done" ? "Loading the new version…" : pendingAll ? "Making this short again, then the others…" : "Making the short again…"}
                </b>
                {running && (
                  <div className="h-1.5 max-w-[320px] overflow-hidden rounded-full bg-hover">
                    <i className="block h-full bg-moment transition-[width] duration-500 ease-linear" style={{ width: `${Math.min(95, ((now - started) / 1000 / 45) * 100)}%` }} />
                  </div>
                )}
              </div>
            ) : allRunning ? (
              <b className="flex items-center gap-2 text-sm">
                <LoaderCircle className="size-4 animate-spin text-moment" aria-hidden="true" /> Giving every short this look: {all?.done ?? 0} of {all?.total || total} done
              </b>
            ) : nChanges ? (
              <>
                <div className="grid gap-1">
                  <b className="text-sm">
                    {nChanges} change{nChanges > 1 ? "s" : ""}
                  </b>
                  {total > 1 && (
                    <Checkbox checked={toAll && lookChanged} disabled={!lookChanged} onChange={setToAll}>
                      Use this look for all {total} shorts
                    </Checkbox>
                  )}
                  {job?.state === "failed" && (
                    <span className="flex items-center gap-1.5 text-[13px] text-bad">
                      <CircleAlert className="size-4 shrink-0" aria-hidden="true" /> {job.error}
                    </span>
                  )}
                </div>
                <span className="flex gap-2">
                  <button type="button" onClick={undo} className={cn(btn, btnGhost)}>
                    Undo all
                  </button>
                  <button type="button" onClick={save} disabled={locked || newLen < 5} className={cn(btn, btnCta)}>
                    Save changes
                  </button>
                </span>
              </>
            ) : (
              <>
                <div className="grid gap-0.5">
                  <b className="text-sm font-medium text-muted-foreground">No changes yet</b>
                </div>
                <button type="button" disabled className={cn(btn, btnCta)}>
                  Save changes
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      <Toast msg={toast.msg} />
    </div>
  );
}
