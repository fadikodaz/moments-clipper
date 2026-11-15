import Link from "next/link";
import { Captions, Crop, Film, GalleryHorizontalEnd, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Maker = { title: string; body: string; icon: LucideIcon; href?: string; isNew?: boolean };

const MAKERS: Maker[] = [
  { title: "Long video to shorts", body: "Find the best moments and cut them vertical", icon: GalleryHorizontalEnd, href: "/clips" },
  { title: "Add captions", body: "Keep your edit, add animated captions", icon: Captions },
  { title: "Make it vertical", body: "Reframe a finished video for phones", icon: Crop },
  { title: "Narration video", body: "Turn a written story into an animated short", icon: Film, href: "/narration", isNew: true },
];

export function Makers() {
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {MAKERS.map((m) => {
        const Icon = m.icon;
        const body = (
          <>
            <span
              className={cn(
                "mb-2 grid size-8 place-items-center rounded-[9px] border bg-raised",
                m.isNew && "border-transparent bg-moment-soft text-moment",
              )}
            >
              <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <b className="text-[13px] font-semibold">
              {m.title}
              {m.isNew && <em className="ml-1 text-[10px] font-semibold not-italic text-moment">New</em>}
              {!m.href && <em className="ml-1 text-[10px] font-medium not-italic text-subtle">Soon</em>}
            </b>
            <small className="text-xs leading-snug text-subtle">{m.body}</small>
          </>
        );
        const cls = "grid content-start gap-1 rounded-lg border bg-panel p-3.5 text-left";
        return m.href ? (
          <Link key={m.title} href={m.href} className={cn(cls, "transition-colors hover:border-border-strong hover:bg-raised")}>
            {body}
          </Link>
        ) : (
          <div key={m.title} className={cn(cls, "opacity-75")} aria-disabled="true">
            {body}
          </div>
        );
      })}
    </div>
  );
}
