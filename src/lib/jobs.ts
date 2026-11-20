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

/** What the user chose before starting. */
export type JobOptions = { layout: FacecamLayout; length: "auto" | "short" | "long"; count: number; captions: "bold" | "simple" | "none" };
export const DEFAULT_OPTIONS: JobOptions = { layout: "auto", length: "auto", count: 0, captions: "bold" };

export function parseOptions(raw: Record<string, unknown> | URLSearchParams): JobOptions {
  const get = (k: string) => (raw instanceof URLSearchParams ? raw.get(k) : raw[k]);
  const layout = String(get("layout") ?? "auto") as FacecamLayout;
  const length = String(get("length") ?? "auto");
  const captions = String(get("captions") ?? "bold");
  const count = Number(get("count") ?? 0);
  return {
    layout: LAYOUTS.includes(layout) ? layout : "auto",
    length: length === "short" || length === "long" ? length : "auto",
    count: Number.isInteger(count) && count >= 0 && count <= 30 ? count : 0,
    captions: captions === "simple" || captions === "none" ? captions : "bold",
  };
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
};
export type JobStatus = {
  state: "queued" | "running" | "done" | "failed" | "cancelled";
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
export async function saveUpload(id: string, body: ReadableStream<Uint8Array>, name: string, options: JobOptions) {
  const ext = videoExtension(name)!;
  await mkdir(outDir(id), { recursive: true });
  const target = path.join(jobDir(id), `source${ext}`);
  const out = createWriteStream(target);
  let bytes = 0;
  const counted = Readable.fromWeb(body as unknown as WebReadableStream<Uint8Array>);
  counted.on("data", (chunk: Buffer) => (bytes += chunk.length));
  await pipeline(counted, out);
  const meta: JobMeta = { id, name: name.replace(/\.[^.]+$/, ""), layout: options.layout, options, bytes, created: Date.now(), source: "upload" };
  await writeFile(path.join(jobDir(id), "meta.json"), JSON.stringify(meta));
  await writeFile(path.join(outDir(id), "status.json"), JSON.stringify({ state: "queued", step: 0, steps: 5, label: "Waiting to start", detail: "", progress: 0, error: null } satisfies JobStatus));
  return { meta, source: target };
}

/** A job for a pasted link: nothing to upload, the engine fetches what it needs. */
export async function createLinkJob(id: string, link: { url: string; title: string; thumbnail: string | null; durationSec?: number }, options: JobOptions) {
  await mkdir(outDir(id), { recursive: true });
  const meta: JobMeta = { id, name: link.title, layout: options.layout, options, bytes: 0, created: Date.now(), source: "youtube", url: link.url, thumbnail: link.thumbnail, durationSec: link.durationSec };
  await writeFile(path.join(jobDir(id), "meta.json"), JSON.stringify(meta));
  await writeFile(path.join(outDir(id), "status.json"), JSON.stringify({ state: "queued", step: 0, steps: 5, label: "Waiting to start", detail: "", progress: 0, error: null } satisfies JobStatus));
  return meta;
}

/** Start the Python engine in the background; it keeps running if the page is closed. Source is a file path or a link. */
export function startEngine(id: string, source: string, o: JobOptions) {
  const log = openSync(path.join(jobDir(id), "engine.log"), "a");
  const args = [ENGINE, source, "--out", outDir(id), "--layout", o.layout, "--length", o.length, "--count", String(o.count), "--captions", o.captions];
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
  let source = meta.url ?? null;
  if (!source) {
    const file = (await readdir(jobDir(id))).find((f) => /^source\.(mp4|mov|mkv|webm)$/i.test(f));
    source = file ? path.join(jobDir(id), file) : null;
  }
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
  const full = path.join(outDir(id), file);
  return full.startsWith(outDir(id) + path.sep) && existsSync(full) ? full : null;
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
};
export type RemakeStatus = { state: "running" | "done" | "failed"; error: string | null; started?: number; updated?: number };

export function parseEdits(raw: unknown): RemakeEdits | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-30, Math.min(30, v)) : 0);
  const layout = SHORT_LAYOUTS.includes(r.layout as ShortLayout) ? (r.layout as ShortLayout) : null;
  const captions = r.captions === "bold" || r.captions === "simple" || r.captions === "none" ? r.captions : null;
  if (!layout || !captions) return null;
  const lines = (Array.isArray(r.lines) ? r.lines : [])
    .filter((l): l is { from: number; to: number; text: string } => !!l && Number.isInteger(l.from) && Number.isInteger(l.to) && typeof l.text === "string")
    .slice(0, 500)
    .map((l) => ({ from: l.from, to: l.to, text: l.text.slice(0, 300) }));
  return { startDelta: num(r.startDelta), endDelta: num(r.endDelta), hook: typeof r.hook === "string" ? r.hook.slice(0, 80) : "", layout, captions, lines };
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
