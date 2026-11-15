import { cn } from "@/lib/utils";

/** The logo mark is a tiny moment line: a flat signal with one peak. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={cn("size-7 shrink-0", className)} aria-hidden="true">
      <rect width="28" height="28" rx="8" className="fill-foreground" />
      <path
        d="M5 17h3l2-4 2 2 2.5-9 2.5 13 2-5 2 3h2"
        fill="none"
        className="stroke-background"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5 text-base font-[650] tracking-[-0.03em]", className)}>
      <LogoMark />
      moments
    </span>
  );
}
