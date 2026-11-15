// Invented example data for building the UI before Supabase is connected.
// Shapes mirror what the real tables will return, so swapping the source later is a small change.

export type SceneKind = "chase" | "stunt" | "funny" | "scenic" | "action" | "podcast";

export type ProjectStatus = "ready" | "processing" | "exported" | "failed";

export type Project = {
  id: string;
  title: string;
  type: "Gameplay" | "Podcast";
  game: string | null;
  durationSec: number;
  status: ProjectStatus;
  progress?: number;
  clips: number;
  kept: number;
  updated: string;
  kind: SceneKind;
  seed: number;
  error?: string;
};

export type Clip = {
  id: string;
  title: string;
  kind: SceneKind;
  score: number;
  startSec: number;
  durSec: number;
  seed: number;
};

export const user = { name: "Rafi", plan: "Pro plan", hoursUsed: 23.5, hoursLimit: 60, storageUsedGb: 3.1, storageLimitGb: 100 };

export const projects: Project[] = [
  { id: "night-run", title: "Night run downtown", type: "Gameplay", game: "GTA VI", durationSec: 8040, status: "ready", clips: 12, kept: 0, updated: "12 min ago", kind: "chase", seed: 3 },
  { id: "podcast-41", title: "Ep. 41: A $500 streaming setup", type: "Podcast", game: null, durationSec: 4380, status: "processing", progress: 0.64, clips: 0, kept: 0, updated: "Now", kind: "podcast", seed: 11 },
  { id: "rp-shift", title: "RP shift: first day as a tow driver", type: "Gameplay", game: "GTA VI", durationSec: 10920, status: "exported", clips: 18, kept: 9, updated: "Yesterday", kind: "funny", seed: 21 },
  { id: "minecraft-hc", title: "Hardcore day 100 attempt", type: "Gameplay", game: "Minecraft", durationSec: 6120, status: "exported", clips: 14, kept: 6, updated: "3 days ago", kind: "scenic", seed: 31 },
  { id: "fortnite-duos", title: "Duos with Maya, ranked", type: "Gameplay", game: "Fortnite", durationSec: 5400, status: "failed", clips: 0, kept: 0, updated: "4 days ago", kind: "action", seed: 41, error: "Upload stopped at 61%. Resume" },
];

export const topClips: Clip[] = [
  { id: "c01", title: "Cop chase ends in the canal", kind: "chase", score: 94, startSec: 2530, durSec: 42, seed: 101 },
  { id: "c02", title: "Bike jump over the drawbridge", kind: "stunt", score: 91, startSec: 5122, durSec: 34, seed: 102 },
  { id: "c03", title: "Ragdoll down the parking garage", kind: "funny", score: 88, startSec: 1412, durSec: 27, seed: 103 },
  { id: "c04", title: "Five-star escape through the marina", kind: "chase", score: 86, startSec: 6620, durSec: 51, seed: 104 },
  { id: "c05", title: "Wrong car, wrong owner", kind: "funny", score: 81, startSec: 3301, durSec: 38, seed: 105 },
];

/** A clip at or above this score is a "top pick" and gets the moment colour. */
export const TOP_PICK = 90;

export function formatDuration(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(r).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
