"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Toast, api, btn, btnPrimary, useToast } from "@/components/kit";
import { ShortsView } from "@/components/shorts/shorts-view";
import type { EngineResult, JobMeta, JobStatus, ReviewMap, Timeline } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { ProgressView } from "./progress-view";

export type JobResponse = { meta: JobMeta; status: JobStatus; result: EngineResult | null; review: ReviewMap; timeline: Timeline | null };

const isRunning = (s: JobStatus) => s.state === "running" || s.state === "queued";

/**
 * One project page. While shorts are being made it shows the live progress; once done, the shorts.
 * If you watched it finish, the progress page stays with an "Open project" button instead of jumping away.
 */
export function JobView({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobResponse | null>(null);
  const [missing, setMissing] = useState(false);
  const [round, setRound] = useState(0);
  const [showProject, setShowProject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sawRunning, setSawRunning] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    async function load() {
      try {
        const r = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (r.status === 404) return setMissing(true);
        const data = (await r.json()) as JobResponse;
        if (stop) return;
        if (isRunning(data.status)) setSawRunning(true);
        setJob(data);
        if (!isRunning(data.status)) return;
      } catch {
        // Network blip while the server restarts; keep polling.
      }
      timer = window.setTimeout(load, 1500);
    }
    load();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [jobId, round]);

  const open = useCallback((clipId?: string) => {
    setShowProject(true);
    if (clipId) window.location.hash = `watch=${clipId}`;
    window.scrollTo({ top: 0 });
  }, []);

  async function act(action: "cancel" | "retry") {
    if (action === "cancel" && !confirm("Stop making shorts for this video? Shorts that are already finished are kept.")) return;
    setBusy(true);
    try {
      await api(`/api/jobs/${jobId}`, { method: "PATCH", json: { action } });
      toast.show(action === "cancel" ? "Stopped. Finished shorts are kept in the project." : "Starting again");
      if (action === "retry") {
        setSawRunning(true);
        setShowProject(false);
      }
      setRound((n) => n + 1);
    } catch (e) {
      toast.show((e as Error).message);
    }
    setBusy(false);
  }

  if (missing) {
    return (
      <div className="mx-auto max-w-sm px-4 pt-16 text-center">
        <h1 className="text-lg font-semibold">Project not found</h1>
        <p className="mt-1.5 text-muted-foreground">It may have been deleted.</p>
        <Link href="/projects" className={cn(btn, btnPrimary, "mt-5")}>
          All projects
        </Link>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="grid place-items-center pt-24">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  const clips = job.result?.clips ?? [];
  const running = isRunning(job.status);
  const progressPage = !showProject && (running || !clips.length || (job.status.state === "done" && sawRunning));

  return (
    <>
      {progressPage ? (
        <ProgressView jobId={jobId} job={job} onOpen={open} onCancel={() => act("cancel")} onRetry={() => act("retry")} busy={busy} />
      ) : (
        <ShortsView
          jobId={jobId}
          meta={job.meta}
          result={job.result!}
          initialReview={job.review}
          notice={
            running
              ? `${clips.length} of ${job.result?.expected ?? "?"} shorts ready. The rest appear here as they finish.`
              : job.status.state === "failed"
                ? `Stopped early: ${clips.length} of ${job.result?.expected ?? clips.length} shorts were made.`
                : job.status.state === "cancelled"
                  ? `You stopped this early: ${clips.length} of ${job.result?.expected ?? clips.length} shorts were made.`
                  : null
          }
        />
      )}
      <Toast msg={toast.msg} />
    </>
  );
}
