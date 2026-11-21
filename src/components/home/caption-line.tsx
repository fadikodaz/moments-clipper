"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** A headline that reads like the shorts the app makes: one word lights up after another, as if spoken. */
export function CaptionLine({ words, className }: { words: string[]; className?: string }) {
  const [on, setOn] = useState(-1);

  useEffect(() => {
    // Reduced motion: no animation; CSS keeps the last word lit instead.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    const t = window.setInterval(() => {
      setOn(i < words.length ? i : -1);
      i = (i + 1) % (words.length + 3); // a short pause before it starts again
    }, 380);
    return () => window.clearInterval(t);
  }, [words.length]);

  return (
    <h1 className={cn("font-heading text-[clamp(34px,4.6vw,56px)] leading-[1.02] font-extrabold tracking-[-0.03em] uppercase", className)} aria-label={words.join(" ")}>
      {words.map((w, i) => (
        <span key={i} aria-hidden="true" className={cn("transition-colors duration-100", i === on && "text-moment", on === -1 && i === words.length - 1 && "motion-reduce:text-moment")}>
          {w}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </h1>
  );
}
