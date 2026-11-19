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

/** A ready-to-paste caption for TikTok, Shorts and Reels. */
export function postCaption(s: Short) {
  const tags = ["gaming", "shorts", ...s.tags]
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((t, i, all) => t && all.indexOf(t) === i)
    .slice(0, 6)
    .map((t) => `#${t}`);
  return `${s.title}\n\n${tags.join(" ")}`;
}
