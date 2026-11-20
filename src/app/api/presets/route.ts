import { listPresets, newJobId, savePreset } from "@/lib/jobs";

/** Saved looks for the set-up screen, newest first. */
export async function GET() {
  return Response.json(await listPresets(), { headers: { "Cache-Control": "no-store" } });
}

/** Save a look: POST { name, style, minLen, maxLen }. A preset with the same name is replaced. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name || !body?.style || typeof body.style !== "object") return Response.json({ error: "Give the look a name." }, { status: 400 });
  const len = (v: unknown) => (typeof v === "number" && v >= 10 && v <= 180 ? Math.round(v) : undefined);
  const preset = { id: newJobId(), name, style: body.style as Record<string, unknown>, minLen: len(body.minLen), maxLen: len(body.maxLen), created: Date.now() };
  return Response.json(await savePreset(preset), { status: 201 });
}
