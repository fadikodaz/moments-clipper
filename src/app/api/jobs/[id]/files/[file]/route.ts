import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { outputFile } from "@/lib/jobs";

/** Serves finished shorts and posters. Supports Range requests so videos can seek and start fast. */
export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/files/[file]">) {
  const { id, file } = await ctx.params;
  const full = outputFile(id, file);
  if (!full) return new Response("Not found", { status: 404 });

  const { size } = await stat(full);
  const type = file.endsWith(".mp4") ? "video/mp4" : "image/jpeg";
  const base = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);

  if (!range) {
    const body = Readable.toWeb(createReadStream(full)) as ReadableStream;
    return new Response(body, { headers: { ...base, "Content-Length": String(size) } });
  }

  let start = range[1] ? Number(range[1]) : size - Number(range[2]);
  let end = range[1] && range[2] ? Number(range[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });

  const body = Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream;
  return new Response(body, {
    status: 206,
    headers: { ...base, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
  });
}
