import { groqKeyWorks, saveKeys, setupStatus } from "@/lib/keys";

/** First-run check: is there a Groq key, and can Python and ffmpeg start? */
export async function GET() {
  return Response.json(await setupStatus(), { headers: { "Cache-Control": "no-store" } });
}

/** POST { groq, claude? }  saves the keys to engine/.env after checking the Groq key. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const groq = typeof body?.groq === "string" ? body.groq.trim() : "";
  const claude = typeof body?.claude === "string" ? body.claude.trim() : "";
  if (!/^gsk_[A-Za-z0-9]{20,}$/.test(groq)) return Response.json({ error: "That doesn't look like a Groq key. It starts with gsk_." }, { status: 400 });
  if (claude && !/^sk-ant-[\w-]{20,}$/.test(claude)) return Response.json({ error: "That doesn't look like a Claude key. It starts with sk-ant-." }, { status: 400 });
  if ((await groqKeyWorks(groq)) === false) return Response.json({ error: "Groq says this key doesn't work. Copy it again." }, { status: 400 });
  await saveKeys(claude ? { GROQ_API_KEY: groq, ANTHROPIC_API_KEY: claude } : { GROQ_API_KEY: groq });
  return Response.json(await setupStatus());
}
