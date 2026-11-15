import { getJob, getResult } from "@/lib/jobs";

/** Job status, plus every short that is already finished. */
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
  // Finished shorts appear here one by one while the rest are still being made.
  const result = await getResult(id);
  return Response.json({ ...job, result }, { headers: { "Cache-Control": "no-store" } });
}
