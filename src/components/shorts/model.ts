import type { EngineClip, ReviewMap } from "@/lib/jobs";

export type Short = EngineClip & { videoUrl: string; posterUrl: string; downloadName: string };
export type Filter = "all" | "saved" | "hidden";
export type Sort = "best" | "time";

export function toShorts(jobId: string, clips: EngineClip[]): Short[] {
  return clips.map((c) => ({
    ...c,
    videoUrl: `/api/jobs/${jobId}/files/${c.file}`,
    posterUrl: `/api/jobs/${jobId}/files/${c.poster}`,
    downloadName: `${c.title.replace(/[^\w\s-]/g, "").trim() || c.id}.mp4`,
  }));
}

/** Scores are relative to this video: its best shorts get the moment colour, the rest plain words. */
export function scoreLabel(score: number, best: number) {
  if (score >= best - 2) return { label: "Best pick", top: true };
  if (score >= 75) return { label: "Strong", top: false };
  if (score >= 70) return { label: "Good", top: false };
  return { label: "Maybe", top: false };
}

export function visibleShorts(all: Short[], review: ReviewMap, filter: Filter, sort: Sort) {
  const list = all.filter((s) => (filter === "all" ? review[s.id] !== "hidden" : review[s.id] === filter));
  return list.sort((a, b) => (sort === "best" ? b.score - a.score : a.startSec - b.startSec));
}

export function formatTime(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
