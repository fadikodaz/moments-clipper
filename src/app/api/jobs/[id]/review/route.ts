import { getJob, setReview, type ReviewState } from "@/lib/jobs";

/** Save, hide or clear one short: PUT { clip: "c03", state: "saved" | "hidden" | null } */
export async function PUT(request: Request, ctx: RouteContext<"/api/jobs/[id]/review">) {
  const { id } = await ctx.params;
  if (!(await getJob(id))) return Response.json({ error: "Job not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { clip?: unknown; state?: unknown } | null;
  const clip = typeof body?.clip === "string" && /^c\d{2,3}$/.test(body.clip) ? body.clip : null;
  const state = body?.state === "saved" || body?.state === "hidden" ? (body.state as ReviewState) : body?.state === null ? null : undefined;
  if (!clip || state === undefined) return Response.json({ error: "Send a clip id and a state of saved, hidden or null." }, { status: 400 });
  return Response.json(await setReview(id, clip, state));
}
