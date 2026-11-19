import type { NextRequest } from "next/server";
import { createLinkJob, getResult, getReview, listJobs, newJobId, parseOptions, saveUpload, startEngine, videoExtension } from "@/lib/jobs";
import { parseLink } from "@/lib/links";

const MAX_BYTES = 20 * 1024 ** 3; // 20 GB, as promised on the upload box

/**
 * Start a job.
 *  - Upload: raw file as the body, POST /api/jobs?name=file.mp4&layout=auto&length=auto&count=0&captions=bold
 *  - Link:   JSON { url, title, thumbnail, durationSec, layout, length, count, captions } (title etc. come from GET /api/link and are display-only)
 */
export async function POST(request: NextRequest) {
  if (request.headers.get("content-type")?.includes("application/json")) return startLink(request);
  const name = request.nextUrl.searchParams.get("name") ?? "";
  const options = parseOptions(request.nextUrl.searchParams);
  if (!videoExtension(name)) return Response.json({ error: "Upload an MP4, MOV, MKV or WEBM file." }, { status: 400 });
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > MAX_BYTES) return Response.json({ error: "Files up to 20 GB are supported." }, { status: 413 });
  if (!request.body) return Response.json({ error: "The upload was empty." }, { status: 400 });

  const id = newJobId();
  const { meta, source } = await saveUpload(id, request.body, name, options);
  if (meta.bytes === 0) return Response.json({ error: "The upload was empty." }, { status: 400 });
  startEngine(id, source, options);
  return Response.json({ id }, { status: 201 });
}

async function startLink(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const link = parseLink(typeof body?.url === "string" ? body.url : "");
  const options = parseOptions(body ?? {});
  if (!link || link.platform !== "youtube") return Response.json({ error: "Paste a YouTube link." }, { status: 400 });
  const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : "YouTube video";
  const thumb = typeof body?.thumbnail === "string" && /^https:\/\/i\d?\.ytimg\.com\//.test(body.thumbnail) ? body.thumbnail : null;
  const id = newJobId();
  const dur = Number(body?.durationSec);
  await createLinkJob(id, { url: link.url, title, thumbnail: thumb, durationSec: Number.isFinite(dur) && dur > 0 ? dur : undefined }, options);
  startEngine(id, link.url, options);
  return Response.json({ id }, { status: 201 });
}

/** Every upload on this computer, newest first, with a cover image and clip count once done. */
export async function GET() {
  const jobs = await listJobs();
  const list = await Promise.all(
    jobs.map(async (j) => {
      const [result, review] = await Promise.all([getResult(j.meta.id), getReview(j.meta.id)]);
      const kept = (result?.clips ?? []).filter((c) => review[c.id] !== "deleted" && review[c.id] !== "hidden");
      const best = kept[0];
      return {
        ...j.meta,
        status: j.status,
        clips: kept.length,
        durationSec: result?.durationSec ?? j.meta.durationSec ?? null,
        topScore: best?.score ?? null,
        cover: best ? `/api/jobs/${j.meta.id}/files/${best.poster}` : (j.meta.thumbnail ?? null),
      };
    }),
  );
  return Response.json(list, { headers: { "Cache-Control": "no-store" } });
}
