import { cn } from "@/lib/utils";

const PATH =
  "M0 30 L40 29 L60 27 L80 30 L110 26 L130 29 L160 24 L180 28 L210 27 L240 29 L260 22 L280 28 L300 26 L330 29 L350 25 L370 28 L392 29 L404 6 L416 29 L440 27 L470 29 L500 24 L520 28 L550 27 L580 29 L600 28";

/**
 * Signature element: a quiet signal that draws in, then one orange peak appears.
 * It is the visual version of what the product does: find the one moment in a long recording.
 * The dot is HTML (not SVG) so it stays round when the line stretches to fit its width.
 */
export function MomentLine({ className }: { className?: string }) {
  return (
    <span className={cn("relative block h-[34px] w-full max-w-[520px]", className)} aria-hidden="true">
      <svg viewBox="0 0 600 40" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <path
          d={PATH}
          fill="none"
          className="animate-draw stroke-border-strong"
          strokeWidth="1.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          pathLength={900}
          strokeDasharray="900"
          strokeDashoffset="900"
        />
      </svg>
      <span className="animate-pop absolute top-[15%] left-[67.33%] size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-moment opacity-0 shadow-[0_0_8px_rgb(255_116_72/0.8)]" />
    </span>
  );
}
