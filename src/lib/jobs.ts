// Server-side only: imported by route handlers and server components, never by client components.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, openSync } from "node:fs";
import { mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

/**
 * Local job storage for the first working version: every upload gets a folder in data/jobs/<id>
 * with the source video, the engine's status.json while it runs, and the finished shorts.
 * Replaced by Supabase + object storage + a queue when this moves to a server.
 */

export const LAYOUTS = ["auto", "top-right", "top-left", "bottom-right", "bottom-left", "none"] as const;
export type FacecamLayout = (typeof LAYOUTS)[number];

/** What the user chose before starting. from/to: only this part of a long video (seconds), at most 4 hours. */
export type JobOptions = {
  layout: FacecamLayout;
  length: "auto" | "short" | "long";
  count: number;
  captions: "bold" | "simple" | "none";
  language: "hi" | "en";
  campaignId?: string | null;
  from?: number | null;
  to?: number | null;
  /** Shortest and longest short in seconds, chosen on the set-up screen (overrides length). */
  minLen?: number | null;
  maxLen?: number | null;
};
export const DEFAULT_OPTIONS: JobOptions = { layout: "auto", length: "auto", count: 0, captions: "bold", language: "hi" };
export const MAX_PART_SECONDS = 4 * 3600;

export function parseOptions(raw: Record<string, unknown> | URLSearchParams): JobOptions {
  const get = (k: string) => (raw instanceof URLSearchParams ? raw.get(k) : raw[k]);
  const layout = String(get("layout") ?? "auto") as FacecamLayout;
  const length = String(get("length") ?? "auto");
  const captions = String(get("captions") ?? "bold");
  const count = Number(get("count") ?? 0);
  const sec = (k: string) => {
    const v = get(k);
    const n = v === null || v === undefined || v === "" ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  };
  const campaignId = String(get("campaignId") ?? "");
  return {
    layout: LAYOUTS.includes(layout) ? layout : "auto",
    length: length === "short" || length === "long" ? length : "auto",
    count: Number.isInteger(count) && count >= 0 && count <= 30 ? count : 0,
    captions: captions === "simple" || captions === "none" ? captions : "bold",
    language: get("language") === "en" ? "en" : "hi",
    campaignId: /^[a-z0-9]{6,40}$/.test(campaignId) ? campaignId : null,
    from: sec("from"),
    to: sec("to"),
    minLen: lengthSec(get("minLen")),
    maxLen: lengthSec(get("maxLen")),
  };
}

function lengthSec(v: unknown) {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) && n >= 10 && n <= 180 ? Math.round(n) : null;
}

/** A problem with the chosen part of the video, or null when it is fine (or no part was chosen). */
export function partProblem(o: JobOptions, durationSec?: number) {
  const whole = o.from == null && o.to == null;
  if (whole) return durationSec && durationSec > MAX_PART_SECONDS ? "This video is longer than 4 hours. Choose a part of up to 4 hours (From and To)." : null;
  const from = o.from ?? 0, to = o.to ?? durationSec ?? 0;
  if (to - from < 60) return "The chosen part must be at least 1 minute long.";
  if (to - from > MAX_PART_SECONDS) return "The chosen part can be at most 4 hours long. Make the rest in another project.";
  if (durationSec && from >= durationSec) return "The chosen part starts after the end of the video.";
  return null;
}

export type JobMeta = {
  id: string;
  name: string;
  layout: FacecamLayout;
  options?: JobOptions;
  bytes: number;
  created: number;
  durationSec?: number;
  /** Where the video came from; links are fetched by the engine itself. */
  source?: "upload" | "youtube";
  url?: string;
  thumbnail?: string | null;
  /** Rules of the clipping campaign this project is for, copied when it started. */
  campaign?: Campaign | null;
};
export type JobStatus = {
  /** setup: made, waiting for the user to choose the look on the set-up screen. */
  state: "setup" | "queued" | "running" | "done" | "failed" | "cancelled";
  step: number;
  steps: number;
  label: string;
  detail: string;
  progress: number;
  /** How far the current step is, 0..1. */
  part?: number;
  started?: number;
  updated?: number;
  error: string | null;
};
export type EngineClip = {
  id: string;
  file: string;
  poster: string;
  title: string;
  score: number;
  startSec: number;
  durSec: number;
  tags: string[];
  reason: string;
  hook: string;
  words: string;
  sub: { hook: number; action: number; reaction: number; clarity: number };
  /** Timed caption words (seconds from the short's start); older projects don't have them. */
  capWords?: { text: string; start: number; end: number }[];
  layout?: ShortLayout;
  captions?: JobOptions["captions"];
  /** How many times the short was made again with edits. */
  edits?: number;
  /** Its full look (engine/style.py). */
  style?: Record<string, unknown>;
  /** Full-size picture of the source at this moment, for the Edit tab's live preview. */
  frame?: string | null;
};
export type EngineResult = {
  video: string;
  duration: string;
  durationSec: number;
  layout: string;
  /** Facecam box found in the video (fractions of the frame), or null when there is none. */
  facecam?: { x: number; y: number; w: number; h: number } | null;
  /** How many shorts the AI picked; clips fills up to this while the job runs. */
  expected?: number;
  complete?: boolean;
  timings_s: Record<string, number>;
  clips: EngineClip[];
};

const ROOT = path.join(process.cwd(), "data", "jobs");
const SETUP_STATUS: JobStatus = { state: "setup", step: 0, steps: 5, label: "Choose how your shorts look", detail: "", progress: 0, error: null };
const ENGINE = path.join(process.cwd(), "engine", "run.py");
const REMAKE = path.join(process.cwd(), "engine", "remake.py");
const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm"]);

export const isJobId = (id: string) => /^[a-z0-9]{6,40}$/.test(id);
export const jobDir = (id: string) => path.join(ROOT, id);
export const outDir = (id: string) => path.join(ROOT, id, "clips");

export function newJobId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function videoExtension(name: string) {
  const ext = path.extname(name).toLowerCase();
  return VIDEO_EXT.has(ext) ? ext : null;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Stream the request body straight to disk, so multi-GB uploads never sit in memory. */
export async function saveUpload(id: string, body: ReadableStream<Uint8Array>, name: string, options: JobOptions, campaign: Campaign | null = null) {
  const ext = videoExtension(name)!;
  await mkdir(outDir(id), { recursive: true });
  const target = path.join(jobDir(id), `source${ext}`);
  const out = createWriteStream(target);
  let bytes = 0;
  const counted = Readable.fromWeb(body as unknown as WebReadableStream<Uint8Array>);
  counted.on("data", (chunk: Buffer) => (bytes += chunk.length));
  await pipeline(counted, out);
  const meta: JobMeta = { id, name: name.replace(/\.[^.]+$/, ""), layout: options.layout, options, bytes, created: Date.now(), source: "upload", campaign };
  await writeFile(path.join(jobDir(id), "meta.json"), JSON.stringify(meta));
  await writeFile(path.join(outDir(id), "status.json"), JSON.stringify(SETUP_STATUS));
  return { meta, source: target };
}

/** A job for a pasted link: nothing to upload, the engine fetches what it needs. */
export async function createLinkJob(id: string, link: { url: string; title: string; thumbnail: string | null; durationSec?: number }, options: JobOptions, campaign: Campaign | null = null) {
  await mkdir(outDir(id), { recursive: true });
  const part = options.from != null || options.to != null ? ` (${clock(options.from ?? 0)} to ${clock(options.to ?? link.durationSec ?? 0)})` : "";
  const meta: JobMeta = { id, name: link.title + part, layout: options.layout, options, bytes: 0, created: Date.now(), source: "youtube", url: link.url, thumbnail: link.thumbnail, durationSec: link.durationSec, campaign };
  await writeFile(path.join(jobDir(id), "meta.json"), JSON.stringify(meta));
  await writeFile(path.join(outDir(id), "status.json"), JSON.stringify(SETUP_STATUS));
  return meta;
}

/** Start the Python engine in the background; it keeps running if the page is closed. Source is a file path or a link. */
export function startEngine(id: string, source: string, o: JobOptions) {
  const log = openSync(path.join(jobDir(id), "engine.log"), "a");
  const args = [ENGINE, source, "--out", outDir(id), "--layout", o.layout, "--length", o.length, "--count", String(o.count), "--captions", o.captions, "--language", o.language ?? "hi"];
  if (o.from != null || o.to != null) args.push("--from", String(o.from ?? 0), "--to", String(o.to ?? o.from! + MAX_PART_SECONDS));
  if (existsSync(path.join(jobDir(id), "campaign.json"))) args.push("--campaign", path.join(jobDir(id), "campaign.json"));
  if (existsSync(path.join(jobDir(id), "style.json"))) args.push("--style", path.join(jobDir(id), "style.json"));
  if (o.minLen && o.maxLen) args.push("--min-len", String(o.minLen), "--max-len", String(o.maxLen));
  const child = spawn(/*turbopackIgnore: true*/ process.env.PYTHON ?? "python", args, {
    cwd: path.dirname(ENGINE),
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
    detached: true,
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  child.on("error", async (e) => {
    const failed: JobStatus = { state: "failed", step: 0, steps: 5, label: "", detail: "", progress: 0, error: `Could not start the engine: ${e.message}` };
    await writeFile(path.join(outDir(id), "status.json"), JSON.stringify(failed)).catch(() => {});
  });
  if (child.pid) writeFile(path.join(jobDir(id), "engine.pid"), String(child.pid)).catch(() => {});
  child.unref();
}

/** Stop a running job. Finished shorts stay; the project keeps whatever was made. */
export async function cancelJob(id: string) {
  const pid = Number(await readFile(path.join(jobDir(id), "engine.pid"), "utf8").catch(() => ""));
  if (pid > 0) {
    await new Promise<void>((resolve) => {
      // taskkill /T also stops the FFmpeg and yt-dlp processes the engine started.
      const k = process.platform === "win32" ? spawn(/*turbopackIgnore: true*/ "taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }) : spawn("kill", ["-TERM", `-${pid}`]);
      k.on("close", () => resolve());
      k.on("error", () => resolve());
    });
  }
  const status = await readJson<JobStatus>(path.join(outDir(id), "status.json"));
  const stopped: JobStatus = { ...(status ?? { step: 0, steps: 5, label: "", progress: 0 }), state: "cancelled", detail: "Stopped", error: null } as JobStatus;
  await writeFile(path.join(outDir(id), "status.json"), JSON.stringify(stopped));
}

/** Run a stopped or failed project again with the same video and choices. The transcript is reused. */
export async function retryJob(id: string) {
  const meta = await readJson<JobMeta>(path.join(jobDir(id), "meta.json"));
  if (!meta) return false;
  const source = await jobSource(id, meta);
  if (!source) return false;
  await rm(outDir(id), { recursive: true, force: true });
  await rm(reviewFile(id), { force: true });
  await mkdir(outDir(id), { recursive: true });
  await writeFile(path.join(outDir(id), "status.json"), JSON.stringify({ state: "queued", step: 0, steps: 5, label: "Waiting to start", detail: "", progress: 0, error: null } satisfies JobStatus));
  startEngine(id, source, meta.options ?? { ...DEFAULT_OPTIONS, layout: meta.layout });
  return true;
}

export async function renameJob(id: string, name: string) {
  const file = path.join(jobDir(id), "meta.json");
  const meta = await readJson<JobMeta>(file);
  if (!meta) return null;
  meta.name = name;
  await writeFile(file, JSON.stringify(meta));
  return meta;
}

export async function deleteJob(id: string) {
  const job = await getJob(id);
  if (job && (job.status.state === "running" || job.status.state === "queued")) await cancelJob(id);
  // Windows can hold the files for a moment after the engine stops.
  for (let i = 0; i < 10; i++) {
    try {
      await rm(jobDir(id), { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

export type Timeline = { durationSec: number; bars: number[]; moments: { id?: string; start: number; end: number; score: number | null; title: string | null }[] };

export async function getTimeline(id: string) {
  if (!isJobId(id)) return null;
  return readJson<Timeline>(path.join(outDir(id), "timeline.json"));
}

export async function getJob(id: string) {
  if (!isJobId(id) || !existsSync(jobDir(id))) return null;
  const meta = await readJson<JobMeta>(path.join(jobDir(id), "meta.json"));
  const status = await readJson<JobStatus>(path.join(outDir(id), "status.json"));
  if (!meta || !status) return null;
  // A job that stopped updating for 10 minutes while "running" has most likely crashed.
  if (status.state === "running" && status.updated && Date.now() / 1000 - status.updated > 600) {
    status.state = "failed";
    status.error = "Making the shorts stopped unexpectedly. Try again, and if it happens again, upload the file instead.";
  }
  return { meta, status };
}

export async function getResult(id: string) {
  if (!isJobId(id)) return null;
  return readJson<EngineResult>(path.join(outDir(id), "clips.json"));
}

export async function listJobs() {
  if (!existsSync(ROOT)) return [];
  const ids = (await readdir(ROOT)).filter(isJobId);
  const jobs = await Promise.all(ids.map(getJob));
  return jobs.filter((j) => j !== null).sort((a, b) => b.meta.created - a.meta.created);
}

/** What the user decided per short. Missing means nothing was decided. */
export type ReviewState = "saved" | "hidden" | "deleted";
export type ReviewMap = Record<string, ReviewState>;

const reviewFile = (id: string) => path.join(jobDir(id), "review.json");

export async function getReview(id: string): Promise<ReviewMap> {
  if (!isJobId(id)) return {};
  return (await readJson<ReviewMap>(reviewFile(id))) ?? {};
}

export async function setReview(id: string, clipId: string, state: ReviewState | null) {
  const review = await getReview(id);
  if (state) review[clipId] = state;
  else delete review[clipId];
  await writeFile(reviewFile(id), JSON.stringify(review));
  return review;
}

/** Delete one short: its files go, and it is remembered as deleted so lists skip it. */
export async function deleteShort(id: string, clipId: string) {
  const result = await getResult(id);
  const clip = result?.clips.find((c) => c.id === clipId);
  if (!clip) return false;
  for (const f of [clip.file, clip.poster]) {
    const full = outputFile(id, f);
    if (full) await unlink(full).catch(() => {});
  }
  await setReview(id, clipId, "deleted");
  return true;
}

/** Resolve a file name inside a job's output folder, refusing anything that could escape it. */
export function outputFile(id: string, file: string) {
  if (!isJobId(id) || !/^[\w.-]+\.(mp4|jpg)$/.test(file)) return null;
  // Set-up screen pictures and test renders live in setup/, finished shorts in clips/.
  const dir = /^(frame\d|test-\d+)\.(jpg|mp4)$/.test(file) ? path.join(jobDir(id), "setup") : outDir(id);
  const full = path.join(dir, file);
  return full.startsWith(dir + path.sep) && existsSync(full) ? full : null;
}

/** Layout of one short: facecam on top, gameplay only, or the whole frame with blurred edges. */
export const SHORT_LAYOUTS = ["facecam", "gameplay", "full"] as const;
export type ShortLayout = (typeof SHORT_LAYOUTS)[number];

/** Changes from the Edit tab. Lines replace caption words by index into the short's current words. */
export type RemakeEdits = {
  startDelta: number;
  endDelta: number;
  hook: string;
  layout: ShortLayout;
  captions: JobOptions["captions"];
  lines: { from: number; to: number; text: string }[];
  /** The full look (engine/style.py); when present it wins over layout/captions. */
  style?: Record<string, unknown> | null;
};
export type RemakeStatus = { state: "running" | "done" | "failed"; error: string | null; started?: number; updated?: number };

export function parseEdits(raw: unknown): RemakeEdits | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-30, Math.min(30, v)) : 0);
  const layout = SHORT_LAYOUTS.includes(r.layout as ShortLayout) ? (r.layout as ShortLayout) : null;
  const captions = r.captions === "bold" || r.captions === "simple" || r.captions === "none" ? r.captions : null;
  const style = r.style && typeof r.style === "object" && !Array.isArray(r.style) ? (r.style as Record<string, unknown>) : null;
  if (!style && (!layout || !captions)) return null;
  const lines = (Array.isArray(r.lines) ? r.lines : [])
    .filter((l): l is { from: number; to: number; text: string } => !!l && Number.isInteger(l.from) && Number.isInteger(l.to) && typeof l.text === "string")
    .slice(0, 500)
    .map((l) => ({ from: l.from, to: l.to, text: l.text.slice(0, 300) }));
  return { startDelta: num(r.startDelta), endDelta: num(r.endDelta), hook: typeof r.hook === "string" ? r.hook.slice(0, 80) : "", layout: layout ?? "facecam", captions: captions ?? "bold", lines, style };
}

const remakeFile = (id: string, clipId: string) => path.join(outDir(id), `remake-${clipId}.json`);
const isClipId = (c: string) => /^c\d{2,3}$/.test(c);

/** A remake that has not reported back for 5 minutes has most likely crashed. */
export async function getRemake(id: string, clipId: string): Promise<RemakeStatus | null> {
  if (!isJobId(id) || !isClipId(clipId)) return null;
  const s = await readJson<RemakeStatus>(remakeFile(id, clipId));
  if (s?.state === "running" && s.updated && Date.now() / 1000 - s.updated > 300) {
    return { ...s, state: "failed", error: "Making the short again stopped unexpectedly. Try once more." };
  }
  return s;
}

/** Make one short again with edits, in the background (about 30-60 seconds). One at a time per project. */
export async function startRemake(id: string, clipId: string, edits: RemakeEdits): Promise<string | null> {
  const job = await getJob(id);
  if (!job) return "Project not found.";
  if (job.status.state === "running" || job.status.state === "queued") return "Wait until all shorts are made, then edit.";
  const result = await getResult(id);
  if (!result?.clips.some((c) => c.id === clipId)) return "This short no longer exists.";
  for (const c of result.clips) {
    if ((await getRemake(id, c.id))?.state === "running") return c.id === clipId ? "This short is already being made again." : "Another short is being made again. Wait for it to finish.";
  }
  const editsFile = path.join(jobDir(id), `edits-${clipId}.json`);
  await writeFile(editsFile, JSON.stringify(edits));
  const now = Date.now() / 1000;
  await writeFile(remakeFile(id, clipId), JSON.stringify({ state: "running", error: null, started: now, updated: now } satisfies RemakeStatus));
  const log = openSync(path.join(jobDir(id), "engine.log"), "a");
  const child = spawn(/*turbopackIgnore: true*/ process.env.PYTHON ?? "python", [REMAKE, jobDir(id), clipId, editsFile], {
    cwd: path.dirname(REMAKE),
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
    detached: true,
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  child.on("error", async (e) => {
    await writeFile(remakeFile(id, clipId), JSON.stringify({ state: "failed", error: `Could not start the engine: ${e.message}` } satisfies RemakeStatus)).catch(() => {});
  });
  child.unref();
  return null;
}

function clock(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/* ---------------- clipping campaigns ---------------- */

/**
 * Rules of a paid clipping campaign (e.g. from Content Rewards). The engine uses streamer, mention,
 * lookFor and avoid when picking moments; the Post kit adds mention and hashtags to every caption.
 */
export type Campaign = {
  id: string;
  name: string;
  streamer: string;
  /** Name every caption and opening line must contain. */
  mention: string;
  /** Hashtags the campaign requires, e.g. ["#KAICENAT"]. */
  hashtags: string[];
  /** Extra hashtags you like to add. */
  extraTags: string[];
  /** Search words titles should use, e.g. ["GTA 6", "GTA VI"]. */
  keywords: string[];
  language: "hi" | "en";
  lookFor: string;
  avoid: string;
  link: string;
  notes: string;
  created: number;
};

const CAMPAIGNS = path.join(process.cwd(), "data", "campaigns.json");

export async function listCampaigns(): Promise<Campaign[]> {
  return (await readJson<Campaign[]>(CAMPAIGNS)) ?? [];
}

export async function getCampaign(id: string | null | undefined) {
  if (!id) return null;
  return (await listCampaigns()).find((c) => c.id === id) ?? null;
}

const tags = (v: unknown) =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,]+/) : [])
    .map((t) => String(t).trim().replace(/^#*/, ""))
    .filter((t) => /^[\p{L}\p{N}_]{1,40}$/u.test(t))
    .slice(0, 15)
    .map((t) => `#${t}`);

export function parseCampaign(raw: unknown, id: string, created: number): Campaign | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (k: string, max: number) => (typeof r[k] === "string" ? (r[k] as string).trim().slice(0, max) : "");
  const name = text("name", 120);
  if (!name) return null;
  const link = text("link", 500);
  return {
    id,
    name,
    streamer: text("streamer", 80),
    mention: text("mention", 80),
    hashtags: tags(r.hashtags),
    extraTags: tags(r.extraTags),
    keywords: (Array.isArray(r.keywords) ? r.keywords.map(String) : typeof r.keywords === "string" ? r.keywords.split(",") : [])
      .map((k) => k.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 10),
    language: r.language === "hi" ? "hi" : "en",
    lookFor: text("lookFor", 1000),
    avoid: text("avoid", 1000),
    link: /^https?:\/\//i.test(link) ? link : "",
    notes: text("notes", 4000),
    created,
  };
}

export async function saveCampaign(c: Campaign) {
  const list = (await listCampaigns()).filter((x) => x.id !== c.id);
  list.unshift(c);
  await mkdir(path.dirname(CAMPAIGNS), { recursive: true });
  await writeFile(CAMPAIGNS, JSON.stringify(list, null, 1));
  return c;
}

export async function deleteCampaign(id: string) {
  const list = await listCampaigns();
  await writeFile(CAMPAIGNS, JSON.stringify(list.filter((x) => x.id !== id), null, 1));
}

/** Copy the campaign into the project folder, so later edits to the campaign don't change finished projects. */
export async function attachCampaign(id: string, campaign: Campaign | null) {
  if (campaign) await writeFile(path.join(jobDir(id), "campaign.json"), JSON.stringify(campaign));
}

/* ---------------- set-up screen ---------------- */

const PROBE = path.join(process.cwd(), "engine", "setup_probe.py");
const TEST = path.join(process.cwd(), "engine", "test_short.py");

/** The video a project works on: its link, or the uploaded file. */
export async function jobSource(id: string, meta?: JobMeta | null) {
  meta ??= await readJson<JobMeta>(path.join(jobDir(id), "meta.json"));
  if (meta?.url) return meta.url;
  const file = (await readdir(jobDir(id)).catch(() => [] as string[])).find((f) => /^source\.(mp4|mov|mkv|webm)$/i.test(f));
  return file ? path.join(jobDir(id), file) : null;
}

function runHelper(id: string, script: string, args: string[]) {
  const log = openSync(path.join(jobDir(id), "engine.log"), "a");
  const child = spawn(/*turbopackIgnore: true*/ process.env.PYTHON ?? "python", [script, ...args], {
    cwd: path.dirname(script),
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
    detached: true,
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  child.on("error", () => {});
  child.unref();
}

export type Probe = {
  state: "running" | "done" | "failed";
  frames?: { file: string; t: number }[];
  box?: { x: number; y: number; w: number; h: number; confidence?: number } | null;
  width?: number;
  height?: number;
  error?: string;
  started?: number;
  updated?: number;
};
export type TestRender = { state: "running" | "done" | "failed"; file?: string; error?: string; started?: number };

const setupDir = (id: string) => path.join(jobDir(id), "setup");

/** Pictures from the video and the facecam box, for the set-up screen (about 10-30 s for a link). */
export async function startProbe(id: string) {
  const meta = await readJson<JobMeta>(path.join(jobDir(id), "meta.json"));
  const source = await jobSource(id, meta);
  if (!meta || !source) return false;
  await mkdir(setupDir(id), { recursive: true });
  await writeFile(path.join(setupDir(id), "probe.json"), JSON.stringify({ state: "running", started: Date.now() / 1000 } satisfies Probe));
  const o = meta.options;
  const args = [jobDir(id), source];
  if (o?.from != null || o?.to != null) args.push("--from", String(o.from ?? 0), "--to", String(o.to ?? (o.from ?? 0) + MAX_PART_SECONDS));
  if (meta.durationSec) args.push("--duration", String(meta.durationSec));
  runHelper(id, PROBE, args);
  return true;
}

export async function getProbe(id: string) {
  const p = await readJson<Probe>(path.join(setupDir(id), "probe.json"));
  if (p?.state === "running" && p.started && Date.now() / 1000 - p.started > 900) return { ...p, state: "failed", error: "Reading the video took too long. Try again." } as Probe;
  return p;
}

let testCount = 0;

/** A 5-second sample with the chosen look. */
export async function startTest(id: string, style: unknown, second: number, hook: string) {
  const source = await jobSource(id);
  if (!source) return false;
  await mkdir(setupDir(id), { recursive: true });
  const n = ++testCount;
  const styleFile = path.join(setupDir(id), `style-test-${n}.json`);
  await writeFile(styleFile, JSON.stringify(style ?? {}));
  await writeFile(path.join(setupDir(id), "test.json"), JSON.stringify({ state: "running", started: Date.now() / 1000 } satisfies TestRender));
  const probe = await getProbe(id);
  const args = [jobDir(id), source, String(Math.max(0, second)), styleFile, "--hook", hook || "This is your opening line", "--n", String(n)];
  if (probe?.box) args.push("--box", JSON.stringify(probe.box));
  runHelper(id, TEST, args);
  return true;
}

export async function getTest(id: string) {
  const t = await readJson<TestRender>(path.join(setupDir(id), "test.json"));
  if (t?.state === "running" && t.started && Date.now() / 1000 - t.started > 600) return { ...t, state: "failed", error: "The test took too long. Try again." } as TestRender;
  return t;
}

/** Leave the set-up screen: save the look and the choices, and start making the shorts. */
export async function startFromSetup(id: string, style: unknown, changes: Partial<JobOptions>) {
  const file = path.join(jobDir(id), "meta.json");
  const meta = await readJson<JobMeta>(file);
  const source = await jobSource(id, meta);
  if (!meta || !source) return "The original video is no longer here. Start a new project.";
  const options: JobOptions = { ...(meta.options ?? { ...DEFAULT_OPTIONS, layout: meta.layout }), ...changes };
  meta.options = options;
  await writeFile(file, JSON.stringify(meta));
  await writeFile(path.join(jobDir(id), "style.json"), JSON.stringify(style ?? {}));
  await writeFile(path.join(outDir(id), "status.json"), JSON.stringify({ state: "queued", step: 0, steps: 5, label: "Waiting to start", detail: "", progress: 0, error: null } satisfies JobStatus));
  startEngine(id, source, options);
  return null;
}

/* ---------------- saved looks (presets) ---------------- */

export type Preset = { id: string; name: string; style: Record<string, unknown>; minLen?: number; maxLen?: number; created: number };
const PRESETS = path.join(process.cwd(), "data", "presets.json");

export async function listPresets(): Promise<Preset[]> {
  return (await readJson<Preset[]>(PRESETS)) ?? [];
}

export async function savePreset(p: Preset) {
  const list = (await listPresets()).filter((x) => x.id !== p.id && x.name.toLowerCase() !== p.name.toLowerCase());
  list.unshift(p);
  await mkdir(path.dirname(PRESETS), { recursive: true });
  await writeFile(PRESETS, JSON.stringify(list.slice(0, 50), null, 1));
  return p;
}

export async function deletePreset(id: string) {
  await writeFile(PRESETS, JSON.stringify((await listPresets()).filter((x) => x.id !== id), null, 1));
}

export type RemakeAllStatus = { state: "running" | "done" | "failed"; done: number; total: number; current?: string; failed?: number; error?: string | null; updated?: number };

export async function getRemakeAll(id: string): Promise<RemakeAllStatus | null> {
  if (!isJobId(id)) return null;
  const s = await readJson<RemakeAllStatus>(path.join(outDir(id), "remake-all.json"));
  if (s?.state === "running" && s.updated && Date.now() / 1000 - s.updated > 900) return { ...s, state: "failed", error: "Making the shorts again stopped unexpectedly." };
  return s;
}

/** Give every short of a project the same look, one after another (about 40 s each). */
export async function startRemakeAll(id: string, style: Record<string, unknown>): Promise<string | null> {
  const job = await getJob(id);
  if (!job) return "Project not found.";
  if (job.status.state === "running" || job.status.state === "queued") return "Wait until all shorts are made, then edit.";
  if ((await getRemakeAll(id))?.state === "running") return "The shorts are already being made again.";
  const result = await getResult(id);
  for (const c of result?.clips ?? []) if ((await getRemake(id, c.id))?.state === "running") return "A short is being made again. Wait for it to finish.";
  const editsFile = path.join(jobDir(id), "edits-all.json");
  await writeFile(editsFile, JSON.stringify({ style }));
  await writeFile(path.join(outDir(id), "remake-all.json"), JSON.stringify({ state: "running", done: 0, total: result?.clips.length ?? 0, updated: Date.now() / 1000 } satisfies RemakeAllStatus));
  runHelper(id, REMAKE, [jobDir(id), "ALL", editsFile]);
  return null;
}
