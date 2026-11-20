"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, LoaderCircle, Play, RotateCcw, Sparkles } from "lucide-react";
import { Toast, api, btn, btnCta, btnGhost, btnLg, field, formatTime, useToast } from "@/components/kit";
import type { JobMeta, Preset, Probe, TestRender } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { Card, CaptionControls, ExtraControls, HookControls, LayoutControls } from "./controls";
import { FrameEditor } from "./frame-editor";
import { PhonePreview } from "./phone-preview";
import { DEFAULT_STYLE, usesCam, withDefaults, type Style } from "./style";

type SetupResponse = { meta: JobMeta; probe: Probe | null; test: TestRender | null };

const COUNTS: [string, string][] = [
  ["0", "Auto (about 1 per 5 minutes)"],
  ["3", "3"],
  ["5", "5"],
  ["10", "10"],
  ["15", "15"],
  ["20", "20"],
];

/** "Set up your shorts": the look of every short, chosen on a real frame before anything is made. */
export function SetupView({ jobId, meta, onStarted }: { jobId: string; meta: JobMeta; onStarted: () => void }) {
  const [data, setData] = useState<SetupResponse | null>(null);
  const [style, setStyle] = useState<Style>(DEFAULT_STYLE);
  const [frame, setFrame] = useState(0);
  const [minLen, setMinLen] = useState(55);
  const [maxLen, setMaxLen] = useState(90);
  const [count, setCount] = useState(meta.options?.count ? String(meta.options.count) : "10");
  const mention = meta.campaign?.mention?.trim();
  const [hook, setHook] = useState(mention ? `${mention} can't believe this happened` : "Wait for the reaction…");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [preset, setPreset] = useState("");
  const [testing, setTesting] = useState<"idle" | "making" | "showing">("idle");
  const [testStarted, setTestStarted] = useState(0);
  const [now, setNow] = useState(0);
  const [starting, setStarting] = useState(false);
  const toast = useToast();

  // The most recent saved look is used by default: one click next time.
  useEffect(() => {
    api<Preset[]>("/api/presets", { cache: "no-store" })
      .then((list) => {
        setPresets(list);
        if (list[0]) {
          setPreset(list[0].id);
          setStyle({ ...withDefaults(list[0].style), cam: null });
          if (list[0].minLen && list[0].maxLen) {
            setMinLen(list[0].minLen);
            setMaxLen(list[0].maxLen);
          }
        }
      })
      .catch(() => {});
  }, []);

  const probeRunning = !data || data.probe?.state === "running";
  // When a test started from this page finishes, show it.
  const testState = data?.test?.state;
  const testDone = testing === "making" && testState === "done" && (data?.test?.started ?? 0) >= testStarted - 1;
  const testFailed = testing === "making" && testState === "failed" && (data?.test?.started ?? 0) >= testStarted - 1;
  const testRunning = data?.test?.state === "running" || (testing === "making" && !testDone && !testFailed);
  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    async function load() {
      try {
        const d = await api<SetupResponse>(`/api/jobs/${jobId}/setup`, { cache: "no-store" });
        if (stop) return;
        setData(d);
        const busy = !d.probe || d.probe.state === "running" || d.test?.state === "running";
        if (!busy) return;
      } catch {
        // keep trying while the server restarts
      }
      timer = window.setTimeout(load, 1500);
    }
    if (probeRunning || testRunning) void load();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [jobId, probeRunning, testRunning]);

  useEffect(() => {
    if (testing !== "making") return;
    const t = window.setInterval(() => setNow(Date.now() / 1000), 300);
    return () => window.clearInterval(t);
  }, [testing]);

  const probe = data?.probe;
  const frames = (probe?.frames ?? []).map((f) => ({ url: `/api/jobs/${jobId}/files/${f.file}`, t: f.t }));
  const detected = probe?.box ? { x: probe.box.x, y: probe.box.y, w: probe.box.w, h: probe.box.h } : null;
  const hasCam = !!(style.cam ?? detected) && !style.nocam;
  // Without a facecam the cam layouts can't work: show gameplay only until one is placed.
  const eff: Style = !hasCam && usesCam({ ...style, nocam: false }) ? { ...style, layout: "game" } : style;
  const set = useCallback((fn: (s: Style) => Style) => {
    setStyle(fn);
    setPreset("");
  }, []);

  async function runTest() {
    setTesting("making");
    setTestStarted(Date.now() / 1000);
    setNow(Date.now() / 1000);
    try {
      await api(`/api/jobs/${jobId}/setup`, { method: "POST", json: { action: "test", style: { ...eff, cam: eff.cam ?? (eff.nocam ? null : detected) }, second: frames[frame]?.t ?? 0, hook } });
      setData((d) => (d ? { ...d, test: { state: "running", started: Date.now() / 1000 } } : d));
    } catch (e) {
      setTesting("idle");
      toast.show((e as Error).message);
    }
  }

  async function savePreset() {
    const name = window.prompt("Name this look", meta.campaign ? `${meta.campaign.streamer || meta.campaign.name} style` : "My style");
    if (!name?.trim()) return;
    try {
      const p = await api<Preset>("/api/presets", { method: "POST", json: { name: name.trim(), style: { ...eff, cam: null }, minLen, maxLen } });
      setPresets((l) => [p, ...l.filter((x) => x.name.toLowerCase() !== p.name.toLowerCase())]);
      setPreset(p.id);
      toast.show(`Saved as “${p.name}”. Next time it's one click.`);
    } catch (e) {
      toast.show((e as Error).message);
    }
  }

  async function start() {
    setStarting(true);
    try {
      await api(`/api/jobs/${jobId}/setup`, {
        method: "POST",
        json: { action: "start", style: { ...eff, cam: eff.cam ?? (usesCam(eff) ? detected : null) }, count: Number(count), minLen, maxLen },
      });
      onStarted();
    } catch (e) {
      toast.show((e as Error).message);
      setStarting(false);
    }
  }

  const o = meta.options;
  const partFrom = o?.from ?? 0;
  const partTo = o?.to ?? meta.durationSec ?? 0;
  const partSec = Math.max(60, partTo - partFrom || meta.durationSec || 3600);
  const n = Number(count) || Math.max(3, Math.round(partSec / 300));
  const minutes = Math.round(3 + (partSec / 3600) * 6 + n * 0.9);
  const pct = (v: number) => ((v - 15) / 165) * 100;

  return (
    <div className="mx-auto max-w-[1260px] px-3.5 pt-[18px] pb-[130px] md:px-8 md:pt-8 md:pb-[120px]">
      <Link href="/projects" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden="true" /> All projects
      </Link>
      <div className="mt-3 mb-[22px] flex items-center gap-3.5">
        {/* eslint-disable-next-line @next/next/no-img-element -- frame from our own route or YouTube thumbnail */}
        {(frames[0]?.url || meta.thumbnail) && <img src={frames[0]?.url || meta.thumbnail!} alt="" className="aspect-video w-[84px] rounded-[10px] object-cover sm:w-[112px]" />}
        <div className="min-w-0">
          <h1 className="text-[17px] leading-[1.2] font-[650] tracking-[-0.03em] sm:text-[22px]">Set up your shorts</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-muted-foreground">
            <span className="line-clamp-1">{meta.name}</span>
            {(o?.from != null || o?.to != null) && !meta.name.includes(formatTime(partFrom)) && (
              <span>
                Part {formatTime(partFrom)} to {formatTime(partTo)}
              </span>
            )}
            {meta.campaign && <span className="rounded-full bg-moment-soft px-2.5 py-0.5 text-xs font-medium text-moment">{meta.campaign.name}</span>}
          </p>
        </div>
      </div>

      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-3.5">
          <Card n={1} title="Where is the facecam?" sub="We look for it automatically. Drag the box to move it, drag a corner to resize. Check another frame to be sure it never moves.">
            {probe?.state === "failed" ? (
              <div className="rounded-xl border bg-raised p-4 text-[13px]">
                <p className="text-bad">{probe.error}</p>
                <button type="button" onClick={() => api(`/api/jobs/${jobId}/setup`, { method: "POST", json: { action: "probe" } }).then(() => setData((d) => (d ? { ...d, probe: { state: "running" } } : d)))} className={cn(btn, "mt-3")}>
                  <RotateCcw aria-hidden="true" /> Try again
                </button>
              </div>
            ) : probeRunning || !frames.length ? (
              <div className="grid aspect-video place-items-center rounded-xl bg-raised text-[13px] text-muted-foreground">
                <span className="flex items-center gap-2">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Looking at your video and finding the facecam…
                </span>
              </div>
            ) : (
              <FrameEditor frames={frames} index={frame} onIndex={setFrame} detected={detected} style={eff} set={set} />
            )}
          </Card>

          <Card n={2} title="Layout" sub="How the wide stream becomes a tall short.">
            <LayoutControls style={eff} set={set} hasCam={hasCam} />
          </Card>

          <Card n={3} title="Length and number" sub="The AI picks moments between these lengths, starting right on the action.">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <span className="flex justify-between text-xs font-medium text-muted-foreground">
                  <span>Length of each short</span>
                  <b className="font-mono text-foreground">
                    {minLen}–{maxLen} s
                  </b>
                </span>
                <div className="relative h-[26px] [&_input]:pointer-events-none [&_input]:absolute [&_input]:inset-0 [&_input]:w-full [&_input]:appearance-none [&_input]:bg-transparent [&_input]:accent-moment [&_input::-moz-range-thumb]:pointer-events-auto [&_input::-webkit-slider-thumb]:pointer-events-auto">
                  <span className="absolute inset-x-0 top-[11px] h-1 rounded bg-hover" />
                  <span className="absolute top-[11px] h-1 rounded bg-moment" style={{ left: `${pct(minLen)}%`, width: `${pct(maxLen) - pct(minLen)}%` }} />
                  <input type="range" min={15} max={180} step={5} value={minLen} aria-label="Shortest" onChange={(e) => setMinLen(Math.min(Number(e.target.value), maxLen - 10))} />
                  <input type="range" min={15} max={180} step={5} value={maxLen} aria-label="Longest" onChange={(e) => setMaxLen(Math.max(Number(e.target.value), minLen + 10))} />
                </div>
              </div>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">How many shorts</span>
                <select value={count} onChange={(e) => setCount(e.target.value)} className={field}>
                  {COUNTS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Card>

          <Card n={4} title="Captions" sub="The words that are said, on screen. See it change on the right.">
            <CaptionControls style={eff} set={set} />
          </Card>

          <Card n={5} title="Opening line" sub={`A short line the AI writes for each short, shown for the first seconds.${mention ? ` It always names ${mention} for this campaign.` : ""}`}>
            <HookControls style={eff} set={set} example={hook} onExample={setHook} />
          </Card>

          <Card n={6} title="Extras" sub="Small things that keep people watching.">
            <ExtraControls style={eff} set={set} noLogos={!!meta.campaign} />
          </Card>

          <div className="sticky bottom-[72px] z-30 mt-1 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-strong bg-raised/95 py-3 pr-3 pl-[18px] shadow-[0_20px_60px_rgb(0_0_0/0.55)] backdrop-blur md:bottom-3.5">
            <span className="text-[13px] text-muted-foreground">
              <b className="text-foreground">{Number(count) ? `${count} shorts` : `About ${n} shorts`}</b>, {minLen}–{maxLen} s each · about {minutes} minutes
            </span>
            <span className="flex gap-2 max-sm:w-full max-sm:[&>*]:flex-1">
              <Link href="/projects" className={cn(btn, btnGhost)}>
                Later
              </Link>
              <button type="button" onClick={start} disabled={starting || probeRunning} className={cn(btn, btnCta, btnLg)}>
                {starting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                {Number(count) ? `Make ${count} shorts` : "Make shorts"}
              </button>
            </span>
          </div>
        </div>

        <aside className="grid justify-items-center gap-3 max-lg:order-first lg:sticky lg:top-6">
          <div className="flex w-full max-w-[288px] gap-2 lg:max-w-none">
            <select
              value={preset}
              aria-label="Saved look"
              onChange={(e) => {
                const p = presets.find((x) => x.id === e.target.value);
                setPreset(e.target.value);
                if (!p) return;
                setStyle({ ...withDefaults(p.style), cam: style.cam, nocam: style.nocam });
                if (p.minLen && p.maxLen) {
                  setMinLen(p.minLen);
                  setMaxLen(p.maxLen);
                }
              }}
              className={field}
            >
              <option value="">{presets.length ? "Your changes (not saved)" : "No saved looks yet"}</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={savePreset} className={btn}>
              Save
            </button>
          </div>

          {testing === "showing" && data?.test?.file ? (
            <video key={data.test.file} src={`/api/jobs/${jobId}/files/${data.test.file}`} autoPlay loop playsInline controls className="h-[512px] w-[288px] rounded-[26px] border border-border-strong bg-black object-cover" />
          ) : (
            <PhonePreview style={eff} frame={frames[frame]?.url ?? null} cam={eff.nocam ? null : detected} hook={hook} />
          )}

          <div className="grid w-[288px] gap-2" aria-live="polite">
            {testing === "making" && !testDone && !testFailed ? (
              <>
                <div className="h-1.5 overflow-hidden rounded-full bg-hover">
                  <i className="block h-full bg-moment transition-[width] duration-300 ease-linear" style={{ width: `${Math.min(95, ((now - testStarted) / 30) * 100)}%` }} />
                </div>
                <p className="text-center text-xs text-muted-foreground">Making a 5-second test with your settings…</p>
              </>
            ) : testDone && testing === "making" ? (
              <button type="button" onClick={() => setTesting("showing")} className={cn(btn, btnCta)}>
                <Play aria-hidden="true" /> Watch the test
              </button>
            ) : testing === "showing" ? (
              <>
                <button type="button" onClick={() => setTesting("idle")} className={btn}>
                  Back to live preview
                </button>
                <p className="text-center text-xs text-muted-foreground">This is the real result. Happy? Make the shorts.</p>
              </>
            ) : (
              <>
                <button type="button" onClick={runTest} disabled={probeRunning || testRunning} className={btn}>
                  <Play aria-hidden="true" /> Make a 5-second test
                </button>
                <p className={cn("text-center text-xs", testFailed ? "text-bad" : "text-muted-foreground")}>
                  {testFailed ? data?.test?.error : "Renders a real sample of this frame's moment with these settings, about 30 seconds."}
                </p>
              </>
            )}
          </div>
        </aside>
      </div>
      <Toast msg={toast.msg} />
    </div>
  );
}
