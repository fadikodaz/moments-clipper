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

export type SubScores = { hook: number; action: number; reaction: number; clarity: number };

export type Clip = {
  id: string;
  title: string;
  kind: SceneKind;
  score: number;
  startSec: number;
  durSec: number;
  seed: number;
  tags: string[];
  /** Plain-language reason the AI picked this moment. */
  reason: string;
  /** Opening line shown over the first seconds of the short. */
  hook: string;
  /** Transcript of what was said, used for captions. */
  words: string;
  /** Optional heads-up, e.g. content that may limit ads. */
  warning?: string;
  sub: SubScores;
  /** Finished short from the engine (real clips only; example clips use drawn placeholders). */
  videoUrl?: string;
  posterUrl?: string;
};

export type ClipLayout = "follow" | "fit" | "split";
export type CaptionStyle = "bold" | "highlight" | "simple" | "none";

export const LAYOUTS: { id: ClipLayout; name: string; desc: string }[] = [
  { id: "follow", name: "Auto crop", desc: "Follows the action in the game" },
  { id: "fit", name: "Fit", desc: "Whole screen with a blurred background" },
  { id: "split", name: "Facecam + gameplay", desc: "Your camera on top, game below" },
];

export const CAPTION_STYLES: { id: CaptionStyle; name: string }[] = [
  { id: "bold", name: "Bold" },
  { id: "highlight", name: "Highlight" },
  { id: "simple", name: "Simple" },
  { id: "none", name: "No captions" },
];

export const user = { name: "Rafi", plan: "Pro plan", hoursUsed: 23.5, hoursLimit: 60, storageUsedGb: 3.1, storageLimitGb: 100 };

export const projects: Project[] = [
  { id: "night-run", title: "Night run downtown", type: "Gameplay", game: "GTA VI", durationSec: 8040, status: "ready", clips: 12, kept: 0, updated: "12 min ago", kind: "chase", seed: 3 },
  { id: "podcast-41", title: "Ep. 41: A $500 streaming setup", type: "Podcast", game: null, durationSec: 4380, status: "processing", progress: 0.64, clips: 0, kept: 0, updated: "Now", kind: "podcast", seed: 11 },
  { id: "rp-shift", title: "RP shift: first day as a tow driver", type: "Gameplay", game: "GTA VI", durationSec: 10920, status: "exported", clips: 18, kept: 9, updated: "Yesterday", kind: "funny", seed: 21 },
  { id: "minecraft-hc", title: "Hardcore day 100 attempt", type: "Gameplay", game: "Minecraft", durationSec: 6120, status: "exported", clips: 14, kept: 6, updated: "3 days ago", kind: "scenic", seed: 31 },
  { id: "fortnite-duos", title: "Duos with Maya, ranked", type: "Gameplay", game: "Fortnite", durationSec: 5400, status: "failed", clips: 0, kept: 0, updated: "4 days ago", kind: "action", seed: 41, error: "Upload stopped at 61%. Resume" },
];

// Sub-scores are invented per scene type here; the real values come from the scoring model.
function subScores(kind: SceneKind, score: number): SubScores {
  const base: Record<SceneKind, [number, number, number, number]> = {
    chase: [88, 95, 70, 80],
    stunt: [92, 90, 66, 85],
    funny: [76, 64, 97, 78],
    scenic: [60, 30, 25, 90],
    action: [70, 97, 40, 75],
    podcast: [70, 40, 80, 85],
  };
  const adj = (score - 80) / 2;
  const c = (v: number) => Math.max(5, Math.min(99, Math.round(v + adj)));
  const [hook, action, reaction, clarity] = base[kind];
  return { hook: c(hook), action: c(action), reaction: c(reaction), clarity: c(clarity) };
}

type RawClip = Omit<Clip, "sub" | "seed">;

const RAW_CLIPS: RawClip[] = [
  { id: "c01", title: "Cop chase ends in the canal", kind: "chase", score: 94, startSec: 2530, durSec: 42, tags: ["Police chase", "Crash", "You laughed"],
    reason: "Sirens and engine noise peak together, 4 hard camera cuts in 6 s, then 3 s of laughter.", hook: "They really thought I'd stop",
    words: "nah nah nah they are NOT catching me tonight wait wait WAIT the canal no no NO" },
  { id: "c02", title: "Bike jump over the drawbridge", kind: "stunt", score: 91, startSec: 5122, durSec: 34, tags: ["Stunt", "Slow motion"],
    reason: "Long airtime with the engine cut out, a loud landing, and you said \u201cdid you see that\u201d.", hook: "Bridge was opening. I didn't care.",
    words: "bridge is going up bridge is going up full send did you SEE that clean landing" },
  { id: "c03", title: "Ragdoll down the parking garage", kind: "funny", score: 88, startSec: 1412, durSec: 27, tags: ["Funny physics", "Fail"],
    reason: "Character tumbles for 9 s, constant impact sounds, longest laugh of the session.", hook: "Gravity hates me specifically",
    words: "I just wanted to take the stairs why is he still rolling he's still going" },
  { id: "c04", title: "Five-star escape through the marina", kind: "chase", score: 86, startSec: 6620, durSec: 51, tags: ["Police chase", "Wanted level"],
    reason: "Wanted level maxes out, then drops to zero. 51 s of continuous high motion.", hook: "Max wanted level \u2192 zero in 50 seconds",
    words: "five stars five stars okay boat boat boat get in the boat and we are GONE" },
  { id: "c05", title: "Wrong car, wrong owner", kind: "funny", score: 81, startSec: 3301, durSec: 38, tags: ["Funny", "Dialogue"],
    reason: "NPC shouting, then you laughing for most of the clip. Strong spoken punchline.", hook: "I picked the wrong car to steal",
    words: "this is my car now sir sir please he's chasing me on foot he's FAST" },
  { id: "c06", title: "Helicopter spotlight hide-and-seek", kind: "chase", score: 79, startSec: 4410, durSec: 45, tags: ["Police chase", "Tension"],
    reason: "Rotor noise holds for 40 s while the camera stays still, then a sudden escape.", hook: "Hiding from a helicopter under a bridge",
    words: "stay still stay still don't move it's right above us okay go go go" },
  { id: "c07", title: "Sunset drive along the causeway", kind: "scenic", score: 72, startSec: 7210, durSec: 30, tags: ["Scenic", "Music"],
    reason: "Low action, but a bright, colorful scene with the radio song chorus.", hook: "This game at golden hour though",
    words: "okay I'm just gonna drive for a second look at this" },
  { id: "c08", title: "Missed the ramp by inches", kind: "stunt", score: 70, startSec: 960, durSec: 22, tags: ["Fail", "Stunt"],
    reason: "Sudden stop after high speed, a crash sound, and you groaned.", hook: "So close.",
    words: "here we go here we go oh no no no no" },
  { id: "c09", title: "Gas station shootout", kind: "action", score: 68, startSec: 2950, durSec: 40, tags: ["Action", "Combat"],
    reason: "Sustained gunfire and explosions. High motion throughout.", hook: "That escalated quickly",
    words: "okay we're just getting gas why is everyone shooting",
    warning: "Graphic violence in the first 7 seconds may limit YouTube ads. Try a later start." },
  { id: "c10", title: "Arguing with the taxi driver", kind: "funny", score: 64, startSec: 3880, durSec: 29, tags: ["Dialogue", "Funny"],
    reason: "Back-and-forth dialogue with a clear reaction at the end.", hook: "Worst taxi ride ever",
    words: "I said the airport not the ocean sir that's the ocean" },
  { id: "c11", title: "Boat into the pier", kind: "funny", score: 61, startSec: 7650, durSec: 19, tags: ["Crash", "Fail"],
    reason: "Loud impact and a sudden stop, but a short reaction.", hook: "Parking skills: none",
    words: "I'll just park right here oh" },
  { id: "c12", title: "Lost the cops in a car wash", kind: "chase", score: 58, startSec: 5790, durSec: 33, tags: ["Police chase"],
    reason: "Sirens fade during a still camera. Good idea, quieter payoff.", hook: "Car wash = invisibility",
    words: "they'll never look in a car wash right right" },
];

export const clips: Clip[] = RAW_CLIPS.map((c, i) => ({ ...c, seed: 101 + i, sub: subScores(c.kind, c.score) }));

export const topClips: Clip[] = [...clips].sort((a, b) => b.score - a.score).slice(0, 5);

/** Plain words typed into search map to tags the AI attached to clips. */
export const SEARCH_ALIASES: Record<string, string> = {
  chase: "Police chase", cop: "Police chase", police: "Police chase", crash: "Crash", funny: "Funny physics",
  fail: "Fail", jump: "Stunt", stunt: "Stunt", talk: "Dialogue", laugh: "You laughed", wanted: "Wanted level",
};

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
