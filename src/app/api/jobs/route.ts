import type { NextRequest } from "next/server";
import { LAYOUTS, getResult, listJobs, newJobId, saveUpload, startEngine, videoExtension, type FacecamLayout } from "@/lib/jobs";

const MAX_BYTES = 20 * 1024 ** 3; // 20 GB, as promised on the upload box

/** Upload a video as the raw request body: POST /api/jobs?name=file.mp4&layout=top-right */
export async function POST(request: NextRequest) {
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
        cover: best ? `/api/jobs/${j.meta.id}/files/${best.poster}` : null,
      };
    }),
  );
  return Response.json(list, { headers: { "Cache-Control": "no-store" } });
}
