"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoaderCircle } from "lucide-react";
import { useJobs } from "@/components/jobs/use-jobs";
import type { Project } from "@/lib/mock-data";
import { ClipsInbox } from "./clips-inbox";

/** The Clips menu opens your newest upload. With no uploads yet, it shows the example project. */
export function ClipsEntry({ example }: { example: Project }) {
  const router = useRouter();
  const jobs = useJobs();
  const latest = jobs?.find((j) => j.status.state === "done");

  useEffect(() => {
    if (latest) router.replace(`/p/${latest.id}`);
  }, [latest, router]);

  if (jobs === null || latest) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-label="Loading your clips" />
      </div>
    );
  }

  return (
    <>
      <p className="mx-3.5 mt-4 rounded-lg border bg-panel px-3.5 py-2.5 text-xs text-muted-foreground sm:mx-7">
        These are example clips. Upload a video on Home and your real shorts show up here.
      </p>
      <ClipsInbox project={example} />
    </>
  );
}
