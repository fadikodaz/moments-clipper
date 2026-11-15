import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { SceneThumb } from "@/components/media/scene-thumb";
import { TOP_PICK, type Clip, type Project } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const LIFT = ["", "-translate-y-1.5", "", "-translate-y-1", ""];

export function ContinueCard({ project, clips }: { project: Project; clips: Clip[] }) {
  const topPicks = clips.filter((c) => c.score >= TOP_PICK).length;

  return (
    <Link
      href="/clips"
      className="group grid items-center gap-6 rounded-xl border p-[18px] pl-[22px] transition-colors hover:border-border-strong md:grid-cols-[minmax(240px,1fr)_auto]"
      style={{ background: "radial-gradient(120% 140% at 100% 0%, rgb(255 116 72 / 0.10), transparent 55%), var(--panel)" }}
    >
      <span className="grid justify-items-start gap-1">
        <span className="inline-flex items-center gap-[7px] text-xs font-medium text-moment">
          <i className="size-[7px] rounded-full bg-moment shadow-[0_0_0_3px_var(--moment-soft)]" />
          {project.clips} clips ready to review
        </span>
        <b className="text-xl font-[650] tracking-[-0.025em]">{project.title}</b>
        <small className="max-w-[44ch] text-xs text-muted-foreground">
          {project.game}, 2:14:00, analyzed {project.updated}. {topPicks} top picks, 1 clip needs a check.
        </small>
        <span className="mt-2.5 inline-flex h-8 items-center gap-1 rounded-md bg-foreground px-3 text-xs font-semibold text-background">
          Review clips
          <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </span>

      <span className="flex gap-2" aria-hidden="true">
        {clips.map((c, i) => (
          <span key={c.id} className={cn("relative block w-[74px] overflow-hidden rounded-[9px] border bg-black", LIFT[i], i >= 2 && "max-sm:hidden")}>
            <span className="block aspect-[9/16]">
              <SceneThumb kind={c.kind} seed={c.seed} orientation="vertical" />
            </span>
            <em
              className={cn(
                "absolute top-[5px] left-[5px] rounded px-[5px] font-mono text-[10px] font-semibold not-italic",
                c.score >= TOP_PICK ? "bg-moment text-moment-ink" : "bg-background/80",
              )}
            >
              {c.score}
            </em>
          </span>
        ))}
      </span>
    </Link>
  );
}
