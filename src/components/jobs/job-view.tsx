"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { MomentLine } from "@/components/brand/moment-line";
import { ShortsView } from "@/components/shorts/shorts-view";
import type { EngineResult, JobMeta, JobStatus, ReviewMap } from "@/lib/jobs";
import { cn } from "@/lib/utils";

type JobResponse = { meta: JobMeta; status: JobStatus; result: EngineResult | null; review: ReviewMap };

const STEPS = ["Reading the audio", "Listening to what you said", "Measuring the action", "Picking the best moments", "Making your shorts"];
function elapsed(from?: number) {
  if (!from) return "";
  const s = Math.max(0, Math.round(Date.now() / 1000 - from));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function JobView({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobResponse | null>(null);
  const [missing, setMissing] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    async function load() {
      try {
        const r = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (r.status === 404) return setMissing(true);
        const data = (await r.json()) as JobResponse;
        if (stop) return;
        setJob(data);
        if (data.status.state === "done" || data.status.state === "failed") return;
      } catch {
        // Network blip while the dev server rebuilds; keep polling.
      }
      timer = window.setTimeout(load, 1500);
    }
    load();
    const clock = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      window.clearInterval(clock);
    };
  }, [jobId]);

  if (missing) {
    return (
      <Centered>
        <h1 className="text-lg font-semibold">Project not found</h1>
        <p className="mt-1.5 text-muted-foreground">It may have been deleted from this computer.</p>
        <BackHome />
      </Centered>
    );
  }

  if (!job) {
    return (
      <Centered>
        <LoaderCircle className="mx-auto size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </Centered>
    );
  }

  const clips = job.result?.clips ?? [];
  if (clips.length && job.status.state !== "failed") {
    const running = job.status.state !== "done";
    return (
      <ShortsView
        jobId={jobId}
        title={job.meta.name.replace(/\.[^.]+$/, "")}
        clips={clips}
        initialReview={job.review}
        banner={
          running && (
            <div className="mb-4 flex items-center gap-2.5 rounded-xl border bg-panel px-3.5 py-2.5 text-[13px]" role="status">
              <LoaderCircle className="size-4 shrink-0 animate-spin text-moment" aria-hidden="true" />
              <span>
                <b className="font-medium">
                  {clips.length} of {job.result?.expected ?? "?"} shorts ready.
                </b>{" "}
                <span className="text-muted-foreground">The rest appear here as they finish; you can start watching now.</span>
              </span>
            </div>
          )
        }
      />
    );
  }
  const { status, meta } = job;
  const failed = status.state === "failed";

  return (
    <Centered wide>
      <p className="mb-1.5 truncate text-muted-foreground">{meta.name}</p>
      <h1 className="text-[clamp(24px,3vw,34px)] leading-tight font-[650] tracking-[-0.035em]">
        {failed ? "Something went wrong" : status.state === "queued" ? "Getting ready" : "Finding your moments"}
      </h1>
      {!failed && <MomentLine className="mt-3" />}

      {failed ? (
        <div className="mt-6 flex gap-2.5 rounded-lg border border-bad/40 bg-bad/8 p-3.5 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden="true" />
          <div>
            <p className="text-foreground">{status.error ?? "The engine stopped."}</p>
            <p className="mt-1 text-xs text-muted-foreground">Details are in data/jobs/{jobId}/engine.log on this computer.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-6 flex items-baseline justify-between text-xs text-muted-foreground">
            <span>{status.detail || status.label || "Waiting to start"}</span>
            <span className="font-mono">
              {Math.round(status.progress * 100)}% · {elapsed(status.started)}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={Math.round(status.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
            <i className="block h-full rounded-full bg-foreground transition-[width] duration-700" style={{ width: `${Math.max(2, status.progress * 100)}%` }} />
          </div>
        </>
      )}

      <ol className="mt-6 grid gap-2.5">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = status.step > n || status.state === "done";
          const active = status.step === n && !failed;
          return (
            <li key={label} className={cn("flex items-center gap-3 text-sm", done ? "text-foreground" : active ? "text-foreground" : "text-subtle")}>
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-medium",
                  done && "border-transparent bg-foreground text-background",
                  active && "border-moment text-moment",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden="true" /> : active ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : n}
              </span>
              {label}
              {active && status.detail && <span className="text-xs text-muted-foreground">{status.detail}</span>}
            </li>
          );
        })}
      </ol>

      <p className="mt-8 text-xs text-subtle">This keeps running if you leave the page. A 1-hour video takes about 5 minutes on this computer; the first shorts show up after about 2.</p>
      {failed && <BackHome />}
    </Centered>
  );
}

function Centered({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={cn("mx-auto px-4 pt-10 pb-16 sm:pt-16", wide ? "max-w-[560px]" : "max-w-sm text-center")}>{children}</div>;
}

function BackHome() {
  return (
    <Link href="/" className="mt-4 inline-flex h-8 items-center rounded-md border bg-raised px-3 text-xs font-medium hover:bg-hover">
      Back to Home
    </Link>
  );
}
