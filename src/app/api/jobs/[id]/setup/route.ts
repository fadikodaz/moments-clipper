import { getJob, getProbe, getTest, parseOptions, startFromSetup, startProbe, startTest } from "@/lib/jobs";

/** Set-up screen data: pictures + facecam box (probe) and the latest 5-second test. */
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/setup">) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: "Project not found" }, { status: 404 });
  const [probe, test] = await Promise.all([getProbe(id), getTest(id)]);
  return Response.json({ ...job, probe, test }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST { action: "probe" }                          look at the video again
 * POST { action: "test", style, second, hook }      make a 5-second sample
 * POST { action: "start", style, count, minLen, maxLen }   make the shorts
 */
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/setup">) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: "Project not found" }, { status: 404 });
  if (job.status.state !== "setup") return Response.json({ error: "These shorts are already being made." }, { status: 409 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const style = body?.style && typeof body.style === "object" ? body.style : {};
  if (body?.action === "probe") {
    if (!(await startProbe(id))) return Response.json({ error: "The original video is no longer here." }, { status: 410 });
    return Response.json({ ok: true });
  }
  if (body?.action === "test") {
    const second = Number(body.second);
    const hook = typeof body.hook === "string" ? body.hook.slice(0, 80) : "";
    if (!(await startTest(id, style, Number.isFinite(second) ? second : 0, hook))) return Response.json({ error: "The original video is no longer here." }, { status: 410 });
    return Response.json({ ok: true });
  }
  if (body?.action === "start") {
    const o = parseOptions(body);
    const problem = await startFromSetup(id, style, { count: o.count, minLen: o.minLen, maxLen: o.maxLen });
    if (problem) return Response.json({ error: problem }, { status: 410 });
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
