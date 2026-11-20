import { cancelJob, deleteJob, getJob, getProbe, getResult, getReview, getTimeline, renameJob, retryJob } from "@/lib/jobs";

/** Job status, every short that is already finished, and the timeline for the progress page. */
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
  // Finished shorts appear here one by one while the rest are still being made.
  const [result, review, timeline, probe] = await Promise.all([getResult(id), getReview(id), getTimeline(id), getProbe(id)]);
  if (result) result.clips = result.clips.filter((c) => review[c.id] !== "deleted");
  const frames = (probe?.frames ?? []).map((f) => ({ url: `/api/jobs/${id}/files/${f.file}`, t: f.t }));
  return Response.json({ ...job, result, review, timeline, frames }, { headers: { "Cache-Control": "no-store" } });
}

/** Rename: PATCH { name }. Stop a running job: PATCH { action: "cancel" }. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { name?: unknown; action?: unknown } | null;
  if (body?.action === "cancel") {
    if (job.status.state !== "running" && job.status.state !== "queued") return Response.json({ error: "This project is not running." }, { status: 409 });
    await cancelJob(id);
    return Response.json({ ok: true });
  }
  if (body?.action === "retry") {
    if (job.status.state === "running" || job.status.state === "queued") return Response.json({ error: "This project is still running." }, { status: 409 });
    if (!(await retryJob(id))) return Response.json({ error: "The original video is no longer on this computer. Upload it again." }, { status: 410 });
    return Response.json({ ok: true });
  }
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return Response.json({ error: "Give the project a name." }, { status: 400 });
  return Response.json(await renameJob(id, name));
}

/** Delete the whole project. A running job is stopped first. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  if (!(await getJob(id))) return Response.json({ error: "Job not found" }, { status: 404 });
  await deleteJob(id);
  return Response.json({ ok: true });
}
