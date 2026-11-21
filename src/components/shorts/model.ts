import type { Campaign, EngineClip, ReviewMap } from "@/lib/jobs";

export type Short = EngineClip & { videoUrl: string; posterUrl: string; frameUrl: string | null; downloadName: string };
export type Sort = "best" | "time";

export function toShorts(jobId: string, clips: EngineClip[]): Short[] {
  return clips.map((c) => ({
    ...c,
    videoUrl: `/api/jobs/${jobId}/files/${c.file}`,
    // The card shows the short with its facecam and captions; older shorts only have the gameplay cover.
    posterUrl: `/api/jobs/${jobId}/files/${c.card ?? c.poster}`,
    frameUrl: c.frame ? `/api/jobs/${jobId}/files/${c.frame}` : null,
    downloadName: `${c.title.replace(/[^\w\s-]/g, "").trim() || c.id}.mp4`,
  }));
}

/** Shown or hidden list, sorted. Deleted shorts never appear. */
export function visibleShorts(all: Short[], review: ReviewMap, hidden: boolean, sort: Sort) {
  const list = all.filter((s) => review[s.id] !== "deleted" && (review[s.id] === "hidden") === hidden);
  return list.sort((a, b) => (sort === "best" ? b.score - a.score : a.startSec - b.startSec));
}

/** What a campaign adds to every caption. */
export type CampaignRules = Pick<Campaign, "mention" | "hashtags" | "extraTags"> | null | undefined;

/** Campaign hashtags first (exactly as required), then the campaign's extras, then ones from the short. */
function hashtags(s: Short, n: number, c: CampaignRules) {
  const required = c?.hashtags ?? [];
  const rest = [...(c?.extraTags ?? []).map((t) => t.replace(/^#/, "")), ...s.tags, "gaming", "shorts"]
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((t) => t && !required.some((r) => r.slice(1).toLowerCase() === t));
  const unique = rest.filter((t, i) => rest.indexOf(t) === i).map((t) => `#${t}`);
  return [...required, ...unique].slice(0, Math.max(n, required.length)).join(" ");
}

/** Makes sure the text names who the campaign is about. */
function named(text: string, c: CampaignRules) {
  const m = c?.mention?.trim();
  if (!m || text.toLowerCase().includes(m.toLowerCase())) return text;
  // "Kai tries to…" becomes "Kai Cenat tries to…" instead of "Kai Cenat: Kai tries to…".
  const first = m.split(/\s+/)[0];
  const re = new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return re.test(text) ? text.replace(re, m) : `${m}: ${text}`;
}

export type Platform = "tiktok" | "shorts" | "reels" | "x";
export const PLATFORMS: [Platform, string][] = [
  ["tiktok", "TikTok"],
  ["shorts", "YouTube Shorts"],
  ["reels", "Instagram Reels"],
  ["x", "X"],
];

/** Ready-to-paste text for each platform, written from the AI's title, opening line and reason. */
export function postKit(s: Short, c?: CampaignRules): Record<Platform, [label: string, text: string][]> {
  const opener = named(s.hook?.trim() || s.title, c);
  const title = named(s.title, c);
  return {
    tiktok: [["Caption", `${opener} ${hashtags(s, 5, c)}`]],
    shorts: [
      ["Title", `${title.slice(0, 90)} ${hashtags(s, 0, c)}`.trim().slice(0, 100)],
      ["Description", `${named(s.reason, c)}\n\n${hashtags(s, 8, c)}`],
    ],
    reels: [["Caption", `${opener}\n\n${s.reason}\n\n${hashtags(s, 8, c)}`]],
    x: [["Post", `${opener} ${hashtags(s, 3, c)}`]],
  };
}

/** The one caption the quick "Copy caption" buttons use (TikTok style, fits everywhere). */
export function postCaption(s: Short, c?: CampaignRules) {
  return postKit(s, c).tiktok[0][1];
}

/** Caption words in lines of five, each with the time it appears and its word range (for remake edits). */
export function captionLines(s: Short, per = 5) {
  const tokens = s.words.split(/\s+/).filter(Boolean);
  const timed = s.capWords?.length === tokens.length ? s.capWords : null;
  const lines: { from: number; to: number; at: number; text: string }[] = [];
  for (let i = 0; i < tokens.length; i += per) {
    const to = Math.min(tokens.length, i + per);
    lines.push({ from: i, to, at: timed ? timed[i].start : (i / tokens.length) * s.durSec, text: tokens.slice(i, to).join(" ") });
  }
  return lines;
}
