"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, RotateCcw, X } from "lucide-react";
import { api, btn, btnGhost, btnPrimary, btnSm } from "@/components/kit";
import type { Qc, RemakeEdits, RemakeStatus } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import type { Short } from "./model";

/** The check result worth showing: nothing when the short passed, was never checked, or the user said it's fine. */
export function qcIssue(s: Short): (Qc & { status: "warn" | "fail" }) | null {
  const q = s.qc;
  if (!q || q.ignored || q.status === "pass" || !q.problems.length) return null;
  return q as Qc & { status: "warn" | "fail" };
}

const tone = { warn: "text-[#f5b83d]", fail: "text-[#f87171]" } as const;
const mark = (level: "warn" | "fail") => (level === "fail" ? "✕" : "!");

/** Round mark on the cover's top-right corner. */
export function QcBadge({ short, className }: { short: Short; className?: string }) {
  const q = qcIssue(short);
  if (!q) return null;
  return (
    <span
      title={q.problems.map((p) => p.text).join(" · ")}
      className={cn(
        "grid size-[26px] place-items-center rounded-full font-mono text-sm font-bold shadow-[0_2px_8px_rgb(0_0_0/0.5)]",
        q.status === "fail" ? "bg-[#ef4444] text-white" : "bg-[#f5b83d] text-[#1a1300]",
        className,
      )}
    >
      <span aria-hidden="true">{mark(q.status)}</span>
      <span className="sr-only">{q.status === "fail" ? "Problem" : "Check"}: {q.problems[0].text}</span>
    </span>
  );
}

/** One line under the title: the most important problem. */
export function QcLine({ short }: { short: Short }) {
  const q = qcIssue(short);
  if (!q) return null;
  const top = q.problems.find((p) => p.level === "fail") ?? q.problems[0];
  return (
    <span className={cn("-mt-1 flex items-baseline gap-1.5 text-[13px]", tone[top.level])}>
      <span aria-hidden="true">{mark(top.level)}</span> {top.text}
      {q.problems.length > 1 && <span className="text-subtle">+{q.problems.length - 1}</span>}
    </span>
  );
}

/** "Quality check: 8 ready · 1 to look at · 1 problem" above the grid; nothing when no short was checked. */
export function QcSummary({ shorts }: { shorts: Short[] }) {
  const checked = shorts.filter((s) => s.qc);
  if (!checked.length) return null;
  const fail = checked.filter((s) => qcIssue(s)?.status === "fail").length;
  const warn = checked.filter((s) => qcIssue(s)?.status === "warn").length;
  const ready = checked.length - fail - warn;
  return (
    <span className="text-[13px] text-muted-foreground">
      Quality check: <b className="font-semibold text-foreground">{ready} ready</b>
      {warn > 0 && <> · {warn} to look at</>}
      {fail > 0 && <> · {fail === 1 ? "1 problem" : `${fail} problems`}</>}
    </span>
  );
}

/** On the short's own page: what's wrong, what's fine, and a one-click fix. */
export function QcBox({ jobId, short, onChanged, toast }: { jobId: string; short: Short; onChanged: () => void; toast: (m: string) => void }) {
  const q = qcIssue(short);
  const [state, setState] = useState<"idle" | "making" | "ignoring">("idle");
  const url = `/api/jobs/${jobId}/clips/${short.id}/remake`;

  // Follow the remake; the page reloads with the new file when it's done.
  useEffect(() => {
    if (state !== "making") return;
    const t = window.setInterval(async () => {
      try {
        const s = await api<RemakeStatus | null>(url, { cache: "no-store" });
        if (s?.state === "done") {
          window.clearInterval(t);
          onChanged();
        } else if (s?.state === "failed") {
          window.clearInterval(t);
          setState("idle");
          toast(s.error ?? "Couldn't make it again.");
        }
      } catch {
        // keep polling
      }
    }, 2500);
    return () => window.clearInterval(t);
  }, [state, url, onChanged, toast]);

  if (!q) return null;
  async function again() {
    setState("making");
    try {
      const edits: RemakeEdits = { startDelta: 0, endDelta: 0, hook: short.hook ?? "", layout: short.layout ?? "facecam", captions: short.captions ?? "bold", lines: [], style: short.style ?? null, fresh: true };
      await api(url, { method: "POST", json: edits });
    } catch (e) {
      setState("idle");
      toast((e as Error).message);
    }
  }

  async function ignore() {
    setState("ignoring");
    try {
      await api(`/api/jobs/${jobId}/clips/${short.id}/qc`, { method: "PUT" });
      onChanged();
    } catch (e) {
      setState("idle");
      toast((e as Error).message);
    }
  }

  return (
    <section aria-label="Quality check" className="mb-[22px] grid gap-3 rounded-2xl border bg-panel p-4">
      <h2 className="text-[15px] font-semibold">Quality check</h2>
      <ul className="grid gap-2 text-sm">
        {q.problems.map((p) => (
          <li key={p.text} className={cn("flex items-baseline gap-2.5", tone[p.level])}>
            <span aria-hidden="true" className="w-4 text-center font-bold">{mark(p.level)}</span>
            {p.text}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={again} disabled={state !== "idle"} className={cn(btn, btnPrimary, btnSm)}>
          {state === "making" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <RotateCcw aria-hidden="true" />}
          {state === "making" ? "Making it again (fresh download, a few minutes)" : "Make it again"}
        </button>
        <button type="button" onClick={ignore} disabled={state !== "idle"} className={cn(btn, btnGhost, btnSm)}>
          <X aria-hidden="true" /> It&apos;s fine, ignore
        </button>
      </div>
    </section>
  );
}
