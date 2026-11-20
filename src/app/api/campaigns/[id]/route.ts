import { deleteCampaign, getCampaign, parseCampaign, saveCampaign } from "@/lib/jobs";

/** Change a campaign. Projects already made keep the rules they were made with. */
export async function PUT(request: Request, ctx: RouteContext<"/api/campaigns/[id]">) {
  const { id } = await ctx.params;
  const old = await getCampaign(id);
  if (!old) return Response.json({ error: "Campaign not found" }, { status: 404 });
  const campaign = parseCampaign(await request.json().catch(() => null), id, old.created);
  if (!campaign) return Response.json({ error: "Give the campaign a name." }, { status: 400 });
  return Response.json(await saveCampaign(campaign));
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/campaigns/[id]">) {
  const { id } = await ctx.params;
  if (!(await getCampaign(id))) return Response.json({ error: "Campaign not found" }, { status: 404 });
  await deleteCampaign(id);
  return Response.json({ ok: true });
}
