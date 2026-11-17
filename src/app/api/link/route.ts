import type { NextRequest } from "next/server";
import { LinkError, getLinkInfo, parseLink } from "@/lib/links";

/** Check a pasted link: GET /api/link?url=… → title, length and thumbnail, or a plain-language error. */
export async function GET(request: NextRequest) {
  const link = parseLink(request.nextUrl.searchParams.get("url") ?? "");
  if (!link) return Response.json({ error: "Paste a YouTube link, like youtube.com/watch?v=…" }, { status: 400 });
  if (link.platform !== "youtube") return Response.json({ error: "Twitch and Kick links are coming next. For now, paste a YouTube link or upload the file." }, { status: 400 });
  try {
    return Response.json(await getLinkInfo(link.url));
  } catch (e) {
    return Response.json({ error: e instanceof LinkError ? e.message : "Couldn't read this link." }, { status: 400 });
  }
}
