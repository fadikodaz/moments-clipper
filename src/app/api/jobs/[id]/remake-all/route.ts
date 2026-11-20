import { getRemakeAll, startRemakeAll } from "@/lib/jobs";

/** Progress of "apply this look to all shorts": { state, done, total, error } or null. */
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/remake-all">) {
  const { id } = await ctx.params;
  return Response.json(await getRemakeAll(id), { headers: { "Cache-Control": "no-store" } });
}

/** Give every short the same look: POST { style }. */
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/remake-all">) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { style?: unknown } | null;
  if (!body?.style || typeof body.style !== "object" || Array.isArray(body.style)) return Response.json({ error: "Send the look as style." }, { status: 400 });
  const problem = await startRemakeAll(id, body.style as Record<string, unknown>);
  if (problem) return Response.json({ error: problem }, { status: problem === "Project not found." ? 404 : 409 });
  return Response.json({ state: "running" }, { status: 202 });
}
