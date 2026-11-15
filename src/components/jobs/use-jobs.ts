"use client";

import { useEffect, useState } from "react";
import type { JobStatus } from "@/lib/jobs";

export type JobSummary = {
  id: string;
  name: string;
  created: number;
  status: JobStatus;
  clips: number;
  durationSec: number | null;
  topScore: number | null;
  cover: string | null;
};

/** Uploads on this computer. Refreshes every few seconds while one is still being processed. */
export function useJobs() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    async function load() {
      try {
        const data = (await (await fetch("/api/jobs", { cache: "no-store" })).json()) as JobSummary[];
        if (stop) return;
        setJobs(data);
        if (data.some((j) => j.status.state === "running" || j.status.state === "queued")) timer = window.setTimeout(load, 3000);
      } catch {
        if (!stop) setJobs((j) => j ?? []);
      }
    }
    load();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, []);

  return jobs;
}
