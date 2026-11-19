import Link from "next/link";
import { Plus } from "lucide-react";
import { ProjectGrid } from "@/components/jobs/project-grid";
import { btn, btnPrimary } from "@/components/kit";
import { cn } from "@/lib/utils";

export const metadata = { title: "Projects | Moments" };

export default function ProjectsPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-3.5 pt-[18px] pb-[130px] md:px-8 md:pt-8 md:pb-[120px]">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] leading-[1.15] font-[650] tracking-[-0.035em]">Projects</h1>
          <p className="mt-1 text-muted-foreground">Every video you turned into shorts on this computer.</p>
        </div>
        <Link href="/" className={cn(btn, btnPrimary)}>
          <Plus aria-hidden="true" /> New clips
        </Link>
      </div>
      <ProjectGrid
        empty={
          <div className="rounded-2xl border border-dashed border-border-strong px-6 py-16 text-center">
            <p className="text-base font-semibold">No projects yet</p>
            <p className="mt-1 text-muted-foreground">Paste a YouTube link or upload a recording to make your first shorts.</p>
            <Link href="/" className={cn(btn, btnPrimary, "mt-5")}>
              <Plus aria-hidden="true" /> New clips
            </Link>
          </div>
        }
      />
    </div>
  );
}
