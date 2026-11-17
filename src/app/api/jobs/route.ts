import type { NextRequest } from "next/server";
import { LAYOUTS, createLinkJob, getResult, listJobs, newJobId, saveUpload, startEngine, videoExtension, type FacecamLayout } from "@/lib/jobs";
import { parseLink } from "@/lib/links";

const MAX_BYTES = 20 * 1024 ** 3; // 20 GB, as promised on the upload box

/**
 * Start a job.
 *  - Upload: raw file as the body, POST /api/jobs?name=file.mp4&layout=top-right
 *  - Link:   JSON { url, layout, title, thumbnail } (title/thumbnail come from GET /api/link and are display-only)
 */
export async function POST(request: NextRequest) {
  if (request.headers.get("content-type")?.includes("application/json")) return startLink(request);
  const name = request.nextUrl.searchParams.get("name") ?? "";
  const layout = (request.nextUrl.searchParams.get("layout") ?? "top-right") as FacecamLayout;
  if (!videoExtension(name)) return Response.json({ error: "Upload an MP4, MOV, MKV or WEBM file." }, { status: 400 });
  if (!LAYOUTS.includes(layout)) return Response.json({ error: "Unknown facecam position." }, { status: 400 });
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > MAX_BYTES) return Response.json({ error: "Files up to 20 GB are supported." }, { status: 413 });
  if (!request.body) return Response.json({ error: "The upload was empty." }, { status: 400 });

  const id = newJobId();
  const { meta, source } = await saveUpload(id, request.body, name, layout);
  if (meta.bytes === 0) return Response.json({ error: "The upload was empty." }, { status: 400 });
  startEngine(id, source, layout);
  return Response.json({ id }, { status: 201 });
}

async function startLink(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { url?: unknown; layout?: unknown; title?: unknown; thumbnail?: unknown } | null;
  const link = parseLink(typeof body?.url === "string" ? body.url : "");
  const layout = (typeof body?.layout === "string" ? body.layout : "top-right") as FacecamLayout;
  if (!link || link.platform !== "youtube") return Response.json({ error: "Paste a YouTube link." }, { status: 400 });
  if (!LAYOUTS.includes(layout)) return Response.json({ error: "Unknown facecam position." }, { status: 400 });
  const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : "YouTube video";
  const thumb = typeof body?.thumbnail === "string" && /^https:\/\/i\d?\.ytimg\.com\//.test(body.thumbnail) ? body.thumbnail : null;
  const id = newJobId();
  await createLinkJob(id, { url: link.url, title, thumbnail: thumb }, layout);
  startEngine(id, link.url, layout);
  return Response.json({ id }, { status: 201 });
}

/** Every upload on this computer, newest first, with a cover image and clip count once done. */
export async function GET() {
  const jobs = await listJobs();
  const list = await Promise.all(
    jobs.map(async (j) => {
      const result = j.status.state === "done" ? await getResult(j.meta.id) : null;
      const best = result?.clips[0];
      return {
        ...j.meta,
        status: j.status,
        clips: result?.clips.length ?? 0,
        durationSec: result?.durationSec ?? null,
        topScore: best?.score ?? null,
        cover: best ? `/api/jobs/${j.meta.id}/files/${best.poster}` : (j.meta.thumbnail ?? null),
      };
    }),
  );
  return Response.json(list, { headers: { "Cache-Control": "no-store" } });
}
