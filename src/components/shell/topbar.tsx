"use client";

import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import { getCrumbs } from "./nav";

export function Topbar() {
  const pathname = usePathname();
  const crumbs = getCrumbs(pathname);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b px-3.5 sm:px-5">
      <p className="truncate text-xs text-subtle">
        {crumbs.map((c, i) => (
          <Fragment key={c}>
            {i > 0 && " / "}
            {i === crumbs.length - 1 ? <b className="font-medium text-foreground">{c}</b> : c}
          </Fragment>
        ))}
      </p>
      {/* The assistant panel is built in a later step; the entry point stays in its final place. */}
      <button
        type="button"
        aria-disabled="true"
        title="The AI assistant arrives in a later step"
        className="inline-flex h-[30px] items-center gap-2 rounded-md border bg-panel pr-2 pl-2.5 text-xs hover:border-border-strong"
      >
        <Sparkles className="size-4 text-moment" strokeWidth={1.75} aria-hidden="true" />
        Ask AI
        <kbd className="hidden rounded border border-border-strong px-1.5 font-mono text-[10px] font-medium text-subtle sm:inline">Ctrl J</kbd>
      </button>
    </header>
  );
}
