import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** API keys live only on this PC, in engine/.env (git ignores it). The engine reads them at the start of every job. */
const ENV = path.join(process.cwd(), "engine", ".env");

async function readEnv(): Promise<Record<string, string>> {
  if (!existsSync(ENV)) return {};
  const text = await readFile(ENV, "utf8");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
  );
}

export async function saveKeys(keys: Record<string, string>) {
  const env = { ...(await readEnv()), ...keys };
  await mkdir(path.dirname(ENV), { recursive: true });
  const body = Object.entries(env)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  await writeFile(ENV, `# API keys: stay on this PC only (git ignores this file)\n${body}\n`);
}

let tools: { python: boolean; ffmpeg: boolean } | null = null;
/** Whether the engine's programs can start (checked once per server run, then again after a failed check). */
function toolCheck() {
  if (tools?.python && tools.ffmpeg) return tools;
  const runs = (cmd: string, args: string[]) => spawnSync(cmd, args, { windowsHide: true, timeout: 8000 }).status === 0;
  tools = { python: runs(process.env.PYTHON ?? "python", ["-c", "import yt_dlp, cv2"]), ffmpeg: runs("ffmpeg", ["-version"]) };
  return tools;
}

/** What the first-run screen needs to know. Never returns the keys themselves. */
export async function setupStatus() {
  const env = await readEnv();
  return { groq: Boolean(env.GROQ_API_KEY), claude: Boolean(env.ANTHROPIC_API_KEY), ...toolCheck() };
}

/** Asks Groq whether the key works, so a typo is caught here instead of in the first job. */
export async function groqKeyWorks(key: string): Promise<boolean | null> {
  try {
    const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    return r.ok ? true : r.status === 401 || r.status === 403 ? false : null;
  } catch {
    return null; // offline or slow: don't block, the key is saved anyway
  }
}
