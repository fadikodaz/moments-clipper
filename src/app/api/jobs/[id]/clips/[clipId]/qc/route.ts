import { ignoreQc } from "@/lib/jobs";

/** "It's fine": PUT hides this short's quality-check warning. */
export async function PUT(_request: Request, ctx: RouteContext<"/api/jobs/[id]/clips/[clipId]/qc">) {
  const { id, clipId } = await ctx.params;
  if (!(await ignoreQc(id, clipId))) return Response.json({ error: "Short not found." }, { status: 404 });
  return Response.json({ ok: true });
}
