"use client";

import Link from "next/link";
import { FileVideo } from "lucide-react";
import { ago, formatTime } from "@/components/kit";
import { useJobs, type JobSummary } from "@/components/jobs/use-jobs";

/** What a project is doing, in a few words; empty when it simply has its shorts. */
function stateOf(j: JobSummary) {
  const s = j.status.state;
  if (s === "running" || s === "queued") return { text: `Making shorts, ${Math.round(j.status.progress * 100)}%`, tone: "text-info" };
  if (s === "setup") return { text: "Waiting for your set-up", tone: "text-moment" };
  if (s === "failed" && !j.clips) return { text: "Didn't finish", tone: "text-bad" };
  if (s === "cancelled" && !j.clips) return { text: "Stopped", tone: "text-muted-foreground" };
  return null;
}

/** The last few projects as a calm list; the full grid lives on the Projects page. */
export function RecentProjects({ limit = 5 }: { limit?: number }) {
  const { jobs } = useJobs();
  if (jobs === null) {
    return (
      <div className="mt-2 grid gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-[74px] animate-shine rounded-xl bg-[linear-gradient(100deg,var(--panel)_30%,var(--raised)_50%,var(--panel)_70%)] bg-[length:300%_100%]" />
        ))}
      </div>
    );
  }
  if (!jobs.length) return null;
  return (
    <section className="mx-auto mt-12 max-w-[760px]" aria-labelledby="recent">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="recent" className="text-lg font-bold tracking-[-0.02em]">
          Recent
        </h2>
        {jobs.length > limit && (
          <Link href="/projects" className="text-[13px] text-muted-foreground hover:text-foreground">
            All {jobs.length} projects
          </Link>
        )}
      </div>
      <ul className="-mx-2.5">
        {jobs.slice(0, limit).map((j) => {
          const st = stateOf(j);
          const part = j.options?.from != null && j.options?.to != null ? `${formatTime(j.options.from)} to ${formatTime(j.options.to)}` : null;
          return (
            <li key={j.id}>
              <Link href={`/p/${j.id}`} className="grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-xl p-2.5 hover:bg-panel">
                <span className="block aspect-video overflow-hidden rounded-lg bg-raised">
                  {j.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element -- our own poster, or the YouTube thumbnail
                    <img src={j.cover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="grid h-full place-items-center text-subtle">
                      <FileVideo className="size-5" strokeWidth={1.5} aria-hidden="true" />
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <b className="block truncate text-[15px] font-semibold">{j.name.replace(/\s*\(\d+:\d\d:\d\d to \d+:\d\d:\d\d\)$/, "")}</b>
                  <span className={`block truncate text-[13px] ${st ? st.tone : "text-muted-foreground"}`}>{st ? st.text : (part ?? ago(j.created))}</span>
                </span>
                {j.clips > 0 && (
                  <span className="text-right text-[13px] text-muted-foreground">
                    <b className="font-semibold text-foreground">{j.clips}</b> shorts
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
