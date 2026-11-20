import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { crc32 } from "node:zlib";
import { PLATFORMS, postKit, toShorts } from "@/components/shorts/model";
import { getJob, getResult, outputFile } from "@/lib/jobs";

/**
 * Several shorts as one ZIP: GET /api/jobs/<id>/zip?clips=c01,c03
 * Each short comes with a .txt holding its ready-to-paste title, captions and hashtags per platform.
 * Videos are already compressed, so files are stored as-is (no re-compression) and streamed,
 * which keeps memory flat even for large downloads.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/zip">) {
  const { id } = await ctx.params;
  const result = await getResult(id);
  if (!result) return new Response("Not found", { status: 404 });
  const wanted = new URL(request.url).searchParams.get("clips")?.split(",") ?? [];
  const picked = result.clips.filter((c) => wanted.includes(c.id));
  if (!picked.length) return new Response("Choose at least one short", { status: 400 });

  const campaign = (await getJob(id))?.meta.campaign ?? null;
  const shorts = toShorts(id, picked);
  const files: Entry[] = [];
  for (const [i, c] of picked.entries()) {
    const full = outputFile(id, c.file);
    if (!full) continue;
    const safe = c.title.replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || c.id;
    const base = `${String(i + 1).padStart(2, "0")} ${safe}`;
    files.push({ full, name: `${base}.mp4`, size: (await stat(full)).size });
    const kit = postKit(shorts[i], campaign);
    const text = PLATFORMS.map(([k, label]) => `${label}\r\n${kit[k].map(([l, t]) => `${l}:\r\n${t.replace(/\n/g, "\r\n")}`).join("\r\n\r\n")}`).join("\r\n\r\n----------\r\n\r\n");
    const data = Buffer.from(text + "\r\n", "utf8");
    files.push({ data, name: `${base}.txt`, size: data.length });
  }

  const project = result.video.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-");
  const body = Readable.toWeb(Readable.from(zipStream(files))) as ReadableStream;
  return new Response(body, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${project}-shorts.zip"` },
  });
}

type Entry = { full?: string; data?: Buffer; name: string; size: number };

/** Minimal ZIP writer (stored entries, sizes known up front, CRC computed while streaming). */
async function* zipStream(files: Entry[]) {
  const central: Buffer[] = [];
  let offset = 0;
  const [time, date] = dosTime(new Date());

  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0808, 6); // bit 3: sizes/CRC follow the data; bit 11: UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt16LE(name.length, 26);
    yield local;
    yield name;

    let crc = 0;
    if (f.data) {
      crc = crc32(f.data);
      yield f.data;
    } else {
      for await (const chunk of createReadStream(f.full!)) {
        crc = crc32(chunk as Buffer, crc);
        yield chunk as Buffer;
      }
    }

    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc >>> 0, 4);
    desc.writeUInt32LE(f.size, 8);
    desc.writeUInt32LE(f.size, 12);
    yield desc;

    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0808, 8);
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(time, 12);
    head.writeUInt16LE(date, 14);
    head.writeUInt32LE(crc >>> 0, 16);
    head.writeUInt32LE(f.size, 20);
    head.writeUInt32LE(f.size, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);
    offset += 30 + name.length + f.size + 16;
  }

  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  yield dir;
  yield end;
}

function dosTime(d: Date): [number, number] {
  return [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()];
}
