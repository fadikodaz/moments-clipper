// Server-side only: checks a pasted link with yt-dlp before a job is started.
import { spawn } from "node:child_process";

export type LinkPlatform = "youtube" | "twitch" | "kick";
export type LinkInfo = { url: string; platform: LinkPlatform; title: string; channel: string; durationSec: number; thumbnail: string | null };

const HOSTS: Record<LinkPlatform, string[]> = {
  youtube: ["youtube.com", "youtu.be"],
  twitch: ["twitch.tv"],
  kick: ["kick.com"],
};
const MAX_SECONDS = 24 * 3600; // longer streams are made in parts of up to 4 hours

/** Normalise what people paste ("youtu.be/x", "www.youtube.com/watch?v=x&list=…") into a URL + platform. */
export function parseLink(raw: string): { url: string; platform: LinkPlatform } | null {
  const value = raw.trim();
  if (!value || value.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const platform = (Object.keys(HOSTS) as LinkPlatform[]).find((p) => HOSTS[p].some((h) => host === h || host.endsWith(`.${h}`)));
  return platform ? { url: url.toString(), platform } : null;
}

export class LinkError extends Error {}

function friendly(stderr: string) {
  const s = stderr.toLowerCase();
  if (s.includes("confirm your age") || s.includes("age-restricted")) return "This video is age-restricted on YouTube, so it can't be fetched without signing in. Download it and upload the file instead.";
  if (s.includes("private video")) return "This video is private on YouTube.";
  if (s.includes("members-only") || s.includes("join this channel")) return "This video is for channel members only.";
  if (s.includes("not a bot")) return "YouTube is asking this computer to prove it's not a bot. Try again later, or upload the file instead.";
  if (s.includes("unavailable") || s.includes("not available")) return "YouTube says this video is unavailable.";
  if (s.includes("unsupported url") || s.includes("is not a valid url")) return "That link doesn't point to a single video.";
  return "Couldn't read this link. Check it opens in your browser, or upload the file instead.";
}

/** Title, length and thumbnail without downloading anything. Takes a few seconds. */
export function getLinkInfo(url: string): Promise<LinkInfo> {
  return new Promise((resolve, reject) => {
    const args = ["-m", "yt_dlp", "-J", "--no-warnings", "--no-playlist", "--js-runtimes", "node", "--skip-download", url];
    const child = spawn(/*turbopackIgnore: true*/ process.env.PYTHON ?? "python", args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new LinkError("YouTube took too long to answer. Try again."));
    }, 60_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", () => {
      clearTimeout(timer);
      reject(new LinkError("Couldn't start yt-dlp on this computer. Is Python installed?"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || !out.trim()) return reject(new LinkError(friendly(err)));
      try {
        const j = JSON.parse(out);
        if (j._type === "playlist") return reject(new LinkError("That's a playlist. Paste the link of one video."));
        if (j.live_status === "is_live" || j.live_status === "is_upcoming") return reject(new LinkError("This stream is still live. Paste the link again once it has ended."));
        const durationSec = Math.round(j.duration ?? 0);
        if (durationSec > MAX_SECONDS) return reject(new LinkError("Videos up to 24 hours are supported."));
        if (durationSec < 60) return reject(new LinkError("This video is under a minute. Paste a longer one, like a stream or a gameplay session."));
        resolve({ url, platform: "youtube", title: j.title ?? "YouTube video", channel: j.channel ?? j.uploader ?? "", durationSec, thumbnail: j.thumbnail ?? null });
      } catch {
        reject(new LinkError("YouTube sent an answer we couldn't read. Try again."));
      }
    });
  });
}
