import type { ReactNode } from "react";
import { MomentLine } from "@/components/brand/moment-line";
import { ContinueCard } from "@/components/home/continue-card";
import { Intake } from "@/components/home/intake";
import { Makers } from "@/components/home/makers";
import { RecentProjects } from "@/components/home/recent-projects";
import { projects, topClips, user } from "@/lib/mock-data";

function Block({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-[30px]">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-[-0.01em]">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function HomePage() {
  const current = projects.find((p) => p.status === "ready")!;

  return (
    <div className="px-3.5 pt-[18px] pb-8 sm:px-7 sm:pt-[34px] sm:pb-12">
      <div className="mx-auto max-w-[1040px]">
        <header className="mb-[22px]">
          <p className="mb-1.5 text-muted-foreground">Welcome back, {user.name}</p>
          <h1 className="text-[clamp(30px,3.6vw,44px)] leading-[1.04] font-[650] tracking-[-0.045em]">
            Find the moments
            <br />
            worth posting.
          </h1>
          <MomentLine className="mt-3.5" />
        </header>

        <Intake />

        <Block title="Continue">
          <ContinueCard project={current} clips={topClips} />
        </Block>

        <Block title="Make something">
          <Makers />
        </Block>

        <Block
          title="Recent projects"
          aside={
            <span className="text-xs text-muted-foreground">
              {user.storageUsedGb} of {user.storageLimitGb} GB storage used
            </span>
          }
        >
          <RecentProjects projects={projects} />
        </Block>
      </div>
    </div>
  );
}
