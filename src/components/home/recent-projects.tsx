import Link from "next/link";
import { Ellipsis } from "lucide-react";
import { SceneThumb } from "@/components/media/scene-thumb";
import { formatDuration, type Project, type ProjectStatus } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const DOT: Record<ProjectStatus, string> = {
  ready: "bg-moment",
  processing: "bg-info",
  exported: "bg-good",
  failed: "bg-bad",
};

function badgeLabel(p: Project) {
  switch (p.status) {
    case "ready":
      return "Ready to review";
    case "processing":
      return `Analyzing ${Math.round((p.progress ?? 0) * 100)}%`;
    case "exported":
      return "Posted";
    case "failed":
      return "Needs attention";
  }
}

function meta(p: Project) {
  switch (p.status) {
    case "ready":
      return `${p.clips} clips, ${p.updated}`;
    case "processing":
      return "About 4 min left";
    case "exported":
      return `${p.kept} clips posted, ${p.updated.toLowerCase()}`;
    case "failed":
      return p.error ?? "Something went wrong";
  }
}

export function RecentProjects({ projects }: { projects: Project[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-3.5 gap-y-[18px]">
      {projects.map((p) => (
        <Link key={p.id} href={p.status === "ready" ? "/clips" : "/"} className="group grid min-w-0 gap-2">
          <span className="relative block aspect-video overflow-hidden rounded-[10px] border bg-black transition-colors group-hover:border-border-strong">
            <SceneThumb kind={p.kind} seed={p.seed} />
            <span
              className={cn(
                "absolute top-2 left-2 inline-flex items-center gap-[5px] rounded-full bg-background/80 py-px pr-2 pl-[7px] text-[11px] font-medium backdrop-blur-sm",
                p.status === "failed" && "text-bad",
              )}
            >
              <i className={cn("size-1.5 rounded-full", DOT[p.status])} />
              {badgeLabel(p)}
            </span>
            <span className="absolute right-2 bottom-2 rounded bg-background/80 px-1.5 font-mono text-[11px]">{formatDuration(p.durationSec)}</span>
            {p.status === "processing" && (
              <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
                <i className="block h-full bg-info" style={{ width: `${(p.progress ?? 0) * 100}%` }} />
              </span>
            )}
          </span>
          <span className="grid grid-cols-[1fr_auto] items-start gap-x-1.5">
            <strong className="truncate text-[13px] font-medium">{p.title}</strong>
            <Ellipsis className="row-span-2 size-4 text-subtle" aria-hidden="true" />
            <small className={cn("truncate text-xs text-subtle", p.status === "failed" && "text-bad/90")}>
              {p.game ?? p.type}, {meta(p)}
            </small>
          </span>
        </Link>
      ))}
    </div>
  );
}
