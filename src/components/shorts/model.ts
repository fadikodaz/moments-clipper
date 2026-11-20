import type { EngineClip, ReviewMap } from "@/lib/jobs";

export type Short = EngineClip & { videoUrl: string; posterUrl: string; downloadName: string };
export type Sort = "best" | "time";

export function toShorts(jobId: string, clips: EngineClip[]): Short[] {
  return clips.map((c) => ({
    ...c,
    videoUrl: `/api/jobs/${jobId}/files/${c.file}`,
    posterUrl: `/api/jobs/${jobId}/files/${c.poster}`,
    downloadName: `${c.title.replace(/[^\w\s-]/g, "").trim() || c.id}.mp4`,
  }));
}

/** Shown or hidden list, sorted. Deleted shorts never appear. */
export function visibleShorts(all: Short[], review: ReviewMap, hidden: boolean, sort: Sort) {
  const list = all.filter((s) => review[s.id] !== "deleted" && (review[s.id] === "hidden") === hidden);
  return list.sort((a, b) => (sort === "best" ? b.score - a.score : a.startSec - b.startSec));
}

function hashtags(s: Short, n: number) {
  return [...s.tags, "gaming", "shorts"]
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((t, i, all) => t && all.indexOf(t) === i)
    .slice(0, n)
    .map((t) => `#${t}`)
    .join(" ");
}

export type Platform = "tiktok" | "shorts" | "reels";
export const PLATFORMS: [Platform, string][] = [
  ["tiktok", "TikTok"],
  ["shorts", "YouTube Shorts"],
  ["reels", "Instagram Reels"],
];

/** Ready-to-paste text for each platform, written from the AI's title, opening line and reason. */
export function postKit(s: Short): Record<Platform, [label: string, text: string][]> {
  const opener = s.hook?.trim() || s.title;
  return {
    tiktok: [["Caption", `${opener} ${hashtags(s, 5)}`]],
    shorts: [
      ["Title", s.title.slice(0, 100)],
      ["Description", `${s.reason}\n\n${hashtags(s, 8)}`],
    ],
    reels: [["Caption", `${opener}\n\n${s.reason}\n\n${hashtags(s, 8)}`]],
  };
}

/** The one caption the quick "Copy caption" buttons use (TikTok style, fits everywhere). */
export function postCaption(s: Short) {
  return postKit(s).tiktok[0][1];
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
