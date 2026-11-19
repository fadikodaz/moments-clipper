import { deleteShort, getJob, getReview, setReview, type ReviewState } from "@/lib/jobs";

/** Hide, unhide or delete shorts: PUT { clip: "c03" | ["c03", "c05"], state: "hidden" | "deleted" | null } */
export async function PUT(request: Request, ctx: RouteContext<"/api/jobs/[id]/review">) {
  const { id } = await ctx.params;
  if (!(await getJob(id))) return Response.json({ error: "Job not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { clip?: unknown; state?: unknown } | null;
  const raw: unknown[] = Array.isArray(body?.clip) ? body.clip : [body?.clip];
  const clips = raw.filter((c): c is string => typeof c === "string" && /^c\d{2,3}$/.test(c));
  const s = body?.state;
  const state = s === "saved" || s === "hidden" || s === "deleted" ? (s as ReviewState) : s === null ? null : undefined;
  if (!clips.length || state === undefined) return Response.json({ error: "Send clip ids and a state of hidden, deleted or null." }, { status: 400 });
  for (const clip of clips) {
    if (state === "deleted") await deleteShort(id, clip);
    else await setReview(id, clip, state);
  }
  return Response.json(await getReview(id));
}
