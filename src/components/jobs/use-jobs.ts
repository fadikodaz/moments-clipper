"use client";

import { useCallback, useEffect, useState } from "react";
import type { JobMeta, JobStatus } from "@/lib/jobs";

export type JobSummary = JobMeta & {
  status: JobStatus;
  clips: number;
  durationSec: number | null;
  topScore: number | null;
  cover: string | null;
};

const busy = (j: JobSummary) => j.status.state === "running" || j.status.state === "queued";

/** Projects on this computer. Refreshes every few seconds while one is still being made. */
export function useJobs() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    async function load() {
      try {
        const data = (await (await fetch("/api/jobs", { cache: "no-store" })).json()) as JobSummary[];
        if (stop) return;
        setJobs(data);
        if (data.some(busy)) timer = window.setTimeout(load, 3000);
      } catch {
        if (!stop) setJobs((j) => j ?? []);
      }
    }
    load();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [round]);

  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { jobs, setJobs, reload };
}
