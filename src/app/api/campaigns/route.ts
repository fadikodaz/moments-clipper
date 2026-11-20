import { listCampaigns, newJobId, parseCampaign, saveCampaign } from "@/lib/jobs";

/** Saved clipping campaigns, newest first. */
export async function GET() {
  return Response.json(await listCampaigns(), { headers: { "Cache-Control": "no-store" } });
}

/** Add a campaign: POST { name, streamer, mention, hashtags, extraTags, language, lookFor, avoid, link, notes }. */
export async function POST(request: Request) {
  const campaign = parseCampaign(await request.json().catch(() => null), newJobId(), Date.now());
  if (!campaign) return Response.json({ error: "Give the campaign a name." }, { status: 400 });
  return Response.json(await saveCampaign(campaign), { status: 201 });
}
