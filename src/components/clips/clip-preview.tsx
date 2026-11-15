"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Play } from "lucide-react";
import { SceneThumb } from "@/components/media/scene-thumb";
import { cn } from "@/lib/utils";
import type { ReviewClip } from "./types";

const STEP_MS = 380;
/** The opening line stays on screen for the first few words, like the real export. */
const HOOK_STEPS = 8;

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function useReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(REDUCE_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCE_QUERY).matches,
    // On the server, assume reduced motion so nothing animates before hydration.
    () => true,
  );
}

function isShout(word: string) {
  return word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word);
}

function Captions({ words, index, style }: { words: string[]; index: number; style: ReviewClip["caption"] }) {
  if (style === "none" || !words.length) return null;
  const word = words[index] ?? "";

  if (style === "bold") {
    return (
      <span
        className={cn(
          "font-sans text-[13cqw] leading-none font-black tracking-tight uppercase [paint-order:stroke_fill] [-webkit-text-stroke:0.9cqw_#000]",
          isShout(word) ? "text-moment" : "text-white",
        )}
      >
        {word}
      </span>
    );
  }

  const from = Math.max(0, index - (style === "highlight" ? 1 : 2));
  const windowWords = words.slice(from, from + (style === "highlight" ? 3 : 5));

  if (style === "highlight") {
    return (
      <span className="flex flex-wrap justify-center gap-[1.5cqw] text-[7.5cqw] leading-tight font-extrabold uppercase">
        {windowWords.map((w, i) => (
          <span key={`${from + i}`} className={cn("rounded-[1cqw] px-[1.2cqw]", from + i === index ? "bg-moment text-moment-ink" : "text-white [text-shadow:0_0.4cqw_1.2cqw_#000]")}>
            {w}
          </span>
        ))}
      </span>
    );
  }

  return <span className="rounded-[1.5cqw] bg-black/55 px-[2.5cqw] py-[1cqw] text-[5.5cqw] font-semibold text-white">{windowWords.join(" ")}</span>;
}

function Frame({ clip }: { clip: ReviewClip }) {
  if (clip.layout === "fit") {
    return (
      <>
        <span className="absolute inset-0 scale-125 opacity-70 blur-[6cqw]">
          <SceneThumb kind={clip.kind} seed={clip.seed} />
        </span>
        <span className="absolute inset-x-0 top-1/2 block aspect-video -translate-y-1/2">
          <SceneThumb kind={clip.kind} seed={clip.seed} />
        </span>
      </>
    );
  }
  if (clip.layout === "split") {
    return (
      <>
        <span className="absolute inset-x-0 top-0 grid h-[38%] place-items-end justify-center overflow-hidden border-b-2 border-black bg-gradient-to-b from-[#2a2c33] to-[#17181c]">
          <svg viewBox="0 0 100 70" className="h-[85%]" aria-hidden="true">
            <circle cx="50" cy="28" r="15" fill="#4a4d57" />
            <path d="M18 70c2-16 15-24 32-24s30 8 32 24z" fill="#3a3d46" />
            <rect x="30" y="20" width="40" height="9" rx="4.5" fill="#1d1f24" />
          </svg>
        </span>
        <span className="absolute inset-x-0 bottom-0 h-[62%]">
          <SceneThumb kind={clip.kind} seed={clip.seed} orientation="vertical" />
        </span>
      </>
    );
  }
  return (
    <span className="absolute inset-0">
      <SceneThumb kind={clip.kind} seed={clip.seed} orientation="vertical" />
    </span>
  );
}

/**
 * Stand-in for the real preview player. It shows the chosen layout, opening line and caption
 * style over placeholder art; the real one plays a short preview MP4 with burned-in captions.
 */
export function ClipPreview({ clip, className }: { clip: ReviewClip; className?: string }) {
  const words = useMemo(() => clip.words.split(/\s+/).filter(Boolean), [clip.words]);
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  // null = follow the default (autoplay unless reduced motion); otherwise the person's choice.
  const [choice, setChoice] = useState<"play" | "pause" | null>(null);
  const [lastId, setLastId] = useState(clip.id);

  // Restart when another clip is shown (adjusting state during render, per React guidance).
  if (lastId !== clip.id) {
    setLastId(clip.id);
    setIndex(0);
    setChoice(null);
  }

  const playing = choice ? choice === "play" : !reducedMotion;

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % words.length), STEP_MS);
    return () => window.clearInterval(t);
  }, [playing, words.length]);

  const showHook = clip.hook.trim() && index < HOOK_STEPS;

  return (
    <button
      type="button"
      onClick={() => setChoice(playing ? "pause" : "play")}
      aria-label={playing ? "Pause preview" : "Play preview"}
      className={cn("@container relative block aspect-[9/16] overflow-hidden rounded-[14px] border bg-black text-left", className)}
    >
      <Frame clip={clip} />

      {showHook && (
        <span className="absolute inset-x-[10%] top-[11%] rounded-[2.5cqw] bg-white px-[3cqw] py-[2cqw] text-center text-[5.6cqw] leading-tight font-extrabold text-black shadow-lg">
          {clip.hook}
        </span>
      )}

      <span className="absolute inset-x-[6%] top-[66%] flex justify-center text-center">
        <Captions words={words} index={index} style={clip.caption} />
      </span>

      {!playing && (
        <span className="absolute inset-0 grid place-items-center bg-black/25">
          <span className="grid size-[16cqw] place-items-center rounded-full bg-white/90 text-black">
            <Play className="size-[7cqw] translate-x-[0.4cqw] fill-current" aria-hidden="true" />
          </span>
        </span>
      )}

      <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/15">
        <i className="block h-full bg-white/80 transition-[width] duration-300 ease-linear" style={{ width: `${((index + 1) / words.length) * 100}%` }} />
      </span>
    </button>
  );
}
