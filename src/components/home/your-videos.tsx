"use client";

import Link from "next/link";
import { FileVideo, LoaderCircle, TriangleAlert } from "lucide-react";
import { useJobs, type JobSummary } from "@/components/jobs/use-jobs";
import { formatDuration } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function Card({ job }: { job: JobSummary }) {
  const { state, progress, label } = job.status;
  const title = job.name.replace(/\.[^.]+$/, "");
  return (
    <Link href={`/p/${job.id}`} className="group grid min-w-0 gap-2">
      <span className="relative grid aspect-video place-items-center overflow-hidden rounded-[10px] border bg-raised transition-colors group-hover:border-border-strong">
        {job.cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- local file from our own route
          <img src={job.cover} alt="" className="absolute inset-0 h-full w-full object-cover object-top" />
        ) : state === "failed" ? (
          <TriangleAlert className="size-5 text-bad" aria-hidden="true" />
        ) : state === "done" ? (
          <FileVideo className="size-5 text-subtle" aria-hidden="true" />
        ) : (
          <LoaderCircle className="size-5 animate-spin text-subtle" aria-hidden="true" />
        )}
        <span
          className={cn(
            "absolute top-2 left-2 inline-flex items-center gap-[5px] rounded-full bg-background/85 py-px pr-2 pl-[7px] text-[11px] font-medium backdrop-blur-sm",
            state === "failed" && "text-bad",
          )}
        >
          <i className={cn("size-1.5 rounded-full", state === "done" ? "bg-moment" : state === "failed" ? "bg-bad" : "bg-info")} />
          {state === "done" ? `${job.clips} shorts ready` : state === "failed" ? "Needs attention" : `${Math.round(progress * 100)}% · ${label || "Starting"}`}
        </span>
        {job.durationSec != null && <span className="absolute right-2 bottom-2 rounded bg-background/85 px-1.5 font-mono text-[11px]">{formatDuration(job.durationSec)}</span>}
        {(state === "running" || state === "queued") && (
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
            <i className="block h-full bg-info transition-[width]" style={{ width: `${progress * 100}%` }} />
          </span>
        )}
      </span>
      <span className="min-w-0">
        <strong className="block truncate text-[13px] font-medium">{title}</strong>
        <small className="block truncate text-xs text-subtle">
          Uploaded {ago(job.created)}
          {job.topScore != null && `, best score ${job.topScore}`}
        </small>
      </span>
    </Link>
  );
}

/** Real uploads on this computer. Renders nothing until there is at least one. */
export function YourVideos() {
  const jobs = useJobs();
  if (!jobs?.length) return null;
  return (
    <section className="mt-[30px]">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-[-0.01em]">Your videos</h2>
        <span className="text-xs text-muted-foreground">{jobs.length} on this computer</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-3.5 gap-y-[18px]">
        {jobs.map((j) => (
          <Card key={j.id} job={j} />
        ))}
      </div>
    </section>
  );
}
