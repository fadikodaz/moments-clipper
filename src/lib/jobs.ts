// Server-side only: imported by route handlers and server components, never by client components.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, openSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

/**
 * Local job storage for the first working version: every upload gets a folder in data/jobs/<id>
 * with the source video, the engine's status.json while it runs, and the finished shorts.
 * Replaced by Supabase + object storage + a queue when this moves to a server.
 */

export const LAYOUTS = ["top-right", "top-left", "bottom-right", "bottom-left", "none"] as const;
export type FacecamLayout = (typeof LAYOUTS)[number];

export type JobMeta = {
  id: string;
  name: string;
  layout: FacecamLayout;
  bytes: number;
  created: number;
  /** Where the video came from; links are fetched by the engine itself. */
  source?: "upload" | "youtube";
  url?: string;
  thumbnail?: string | null;
};
export type JobStatus = {
  state: "queued" | "running" | "done" | "failed";
  step: number;
  steps: number;
  label: string;
  detail: string;
  progress: number;
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
};
export type EngineResult = {
  video: string;
  duration: string;
  durationSec: number;
  layout: string;
  /** How many shorts the AI picked; clips fills up to this while the job runs. */
  expected?: number;
  complete?: boolean;
  timings_s: Record<string, number>;
  clips: EngineClip[];
};

const ROOT = path.join(process.cwd(), "data", "jobs");
const ENGINE = path.join(process.cwd(), "engine", "run.py");
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
export async function saveUpload(id: string, body: ReadableStream<Uint8Array>, name: string, layout: FacecamLayout) {
  const ext = videoExtension(name)!;
  await mkdir(outDir(id), { recursive: true });
  const target = path.join(jobDir(id), `source${ext}`);
  const out = createWriteStream(target);
  let bytes = 0;
  const counted = Readable.fromWeb(body as unknown as WebReadableStream<Uint8Array>);
  counted.on("data", (chunk: Buffer) => (bytes += chunk.length));
  await pipeline(counted, out);
  const meta: JobMeta = { id, name, layout, bytes, created: Date.now() };
  await writeFile(path.join(jobDir(id), "meta.json"), JSON.stringify(meta));
  await writeFile(path.join(outDir(id), "status.json"), JSON.stringify({ state: "queued", step: 0, steps: 5, label: "Waiting to start", detail: "", progress: 0, error: null } satisfies JobStatus));
  return { meta, source: target };
}

/** A job for a pasted link: nothing to upload, the engine fetches what it needs. */
export async function createLinkJob(id: string, link: { url: string; title: string; thumbnail: string | null }, layout: FacecamLayout) {
  await mkdir(outDir(id), { recursive: true });
  const meta: JobMeta = { id, name: link.title, layout, bytes: 0, created: Date.now(), source: "youtube", url: link.url, thumbnail: link.thumbnail };
  await writeFile(path.join(jobDir(id), "meta.json"), JSON.stringify(meta));
  await writeFile(path.join(outDir(id), "status.json"), JSON.stringify({ state: "queued", step: 0, steps: 5, label: "Waiting to start", detail: "", progress: 0, error: null } satisfies JobStatus));
  return meta;
}

/** Start the Python engine in the background; it keeps running if the page is closed. Source is a file path or a link. */
export function startEngine(id: string, source: string, layout: FacecamLayout) {
  const log = openSync(path.join(jobDir(id), "engine.log"), "a");
  const child = spawn(/*turbopackIgnore: true*/ process.env.PYTHON ?? "python", [ENGINE, source, "--out", outDir(id), "--layout", layout], {
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
  child.unref();
}

export async function getJob(id: string) {
  if (!isJobId(id) || !existsSync(jobDir(id))) return null;
  const meta = await readJson<JobMeta>(path.join(jobDir(id), "meta.json"));
  const status = await readJson<JobStatus>(path.join(outDir(id), "status.json"));
  if (!meta || !status) return null;
  // A job that stopped updating for 10 minutes while "running" has most likely crashed.
  if (status.state === "running" && status.updated && Date.now() / 1000 - status.updated > 600) {
    status.state = "failed";
    status.error = "The engine stopped responding. Check data/jobs/" + id + "/engine.log";
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

/** What the user decided per short: saved (heart) or hidden. Missing means neither. */
export type ReviewState = "saved" | "hidden";
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

/** Resolve a file name inside a job's output folder, refusing anything that could escape it. */
export function outputFile(id: string, file: string) {
  if (!isJobId(id) || !/^[\w.-]+\.(mp4|jpg)$/.test(file)) return null;
  const full = path.join(outDir(id), file);
  return full.startsWith(outDir(id) + path.sep) && existsSync(full) ? full : null;
}
