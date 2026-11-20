import { getRemake, parseEdits, startRemake } from "@/lib/jobs";

/** Is this short being made again? GET returns { state: "running" | "done" | "failed", error } or null. */
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/clips/[clipId]/remake">) {
  const { id, clipId } = await ctx.params;
  return Response.json(await getRemake(id, clipId), { headers: { "Cache-Control": "no-store" } });
}

/** Make the short again with edits: POST { startDelta, endDelta, hook, layout, captions, lines }. */
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/clips/[clipId]/remake">) {
  const { id, clipId } = await ctx.params;
  const edits = parseEdits(await request.json().catch(() => null));
  if (!edits) return Response.json({ error: "Send a layout (facecam, gameplay or full) and captions (bold, simple or none)." }, { status: 400 });
  const problem = await startRemake(id, clipId, edits);
  if (problem) return Response.json({ error: problem }, { status: problem === "Project not found." ? 404 : 409 });
  return Response.json({ state: "running", error: null }, { status: 202 });
}
