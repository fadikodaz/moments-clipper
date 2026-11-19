import Link from "next/link";
import { Intake } from "@/components/home/intake";
import { ProjectGrid } from "@/components/jobs/project-grid";

const STEPS = ["We find the best moments", "We cut them vertical with captions", "You download or post"];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-[1180px] px-3.5 pt-[18px] pb-[130px] md:px-8 md:pt-8 md:pb-[120px]">
      <section className="mx-auto mt-7 max-w-[780px] text-center">
        <h1 className="text-[clamp(30px,4vw,46px)] leading-[1.05] font-[650] tracking-[-0.045em]">Turn a long stream into shorts.</h1>
        <p className="mx-auto mt-3 max-w-[52ch] text-base text-muted-foreground">
          Paste a YouTube link or drop a recording. You get ready-to-post vertical shorts with captions in about 5 minutes.
        </p>
      </section>

      <Intake />

      <ol aria-label="How it works" className="mx-auto mt-[22px] flex flex-wrap justify-center gap-x-7 gap-y-2 text-[13px] text-muted-foreground">
        {STEPS.map((s, i) => (
          <li key={s} className="inline-flex items-center gap-2">
            <i className="grid size-[22px] place-items-center rounded-full bg-raised font-mono text-[11px] font-semibold text-foreground not-italic">{i + 1}</i>
            {s}
          </li>
        ))}
      </ol>

      <div className="mt-14 mb-3.5 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold tracking-[-0.02em]">Your projects</h2>
        <Link href="/projects" className="text-[13px] text-muted-foreground hover:text-foreground">
          View all
        </Link>
      </div>
      <ProjectGrid limit={6} empty={<p className="text-muted-foreground">Your projects show up here. Paste a link above to make your first shorts.</p>} />
    </div>
  );
}
