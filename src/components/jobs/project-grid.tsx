"use client";

import Link from "next/link";
import { useState } from "react";
import { Ellipsis, ExternalLink, FileVideo, Pencil, Trash2 } from "lucide-react";
import { Menu, MenuItem, Toast, ago, api, btn, btnGhost, btnIcon, btnSm, field, formatTime, useToast } from "@/components/kit";
import { cn } from "@/lib/utils";
import { useJobs, type JobSummary } from "./use-jobs";

/** Project cards: cover, state, length; a menu to rename, open the source, or delete. */
export function ProjectGrid({ limit, empty }: { limit?: number; empty?: React.ReactNode }) {
  const { jobs, setJobs } = useJobs();
  const toast = useToast();

  if (jobs === null) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-[18px] gap-y-[22px]" aria-hidden="true">
        {[0, 1, 2].slice(0, limit ?? 3).map((i) => (
          <span key={i} className="aspect-video animate-shine rounded-[14px] bg-[linear-gradient(100deg,var(--panel)_30%,var(--raised)_50%,var(--panel)_70%)] bg-[length:300%_100%]" />
        ))}
      </div>
    );
  }
  if (!jobs.length) return <>{empty ?? null}</>;

  const list = limit ? jobs.slice(0, limit) : jobs;

  async function rename(id: string, name: string) {
    const before = jobs;
    setJobs((js) => js?.map((j) => (j.id === id ? { ...j, name } : j)) ?? js);
    try {
      await api(`/api/jobs/${id}`, { method: "PATCH", json: { name } });
      toast.show("Renamed");
    } catch (e) {
      setJobs(before);
      toast.show((e as Error).message);
    }
  }

  async function remove(j: JobSummary) {
    if (!confirm(`Delete "${j.name}" and its shorts from this computer?`)) return;
    const before = jobs;
    setJobs((js) => js?.filter((x) => x.id !== j.id) ?? js);
    try {
      await api(`/api/jobs/${j.id}`, { method: "DELETE" });
      toast.show("Project deleted");
    } catch (e) {
      setJobs(before);
      toast.show((e as Error).message);
    }
  }

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-[18px] gap-y-[22px]">
        {list.map((j) => (
          <ProjectCard key={j.id} job={j} onRename={(name) => rename(j.id, name)} onDelete={() => remove(j)} />
        ))}
      </div>
      <Toast msg={toast.msg} />
    </>
  );
}

function ProjectCard({ job, onRename, onDelete }: { job: JobSummary; onRename: (name: string) => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const s = job.status.state;
  const running = s === "running" || s === "queued";
  const dur = job.durationSec ? formatTime(job.durationSec) : null;
  const from = job.source === "youtube" ? "From YouTube" : "Uploaded file";

  const chip = running
    ? { dot: "bg-info", text: `Making shorts, ${Math.round(job.status.progress * 100)}%` }
    : s === "setup"
      ? { dot: "bg-moment", text: "Waiting for your set-up" }
      : s === "failed" && !job.clips
      ? { dot: "bg-bad", text: "Didn't finish" }
      : s === "cancelled" && !job.clips
        ? { dot: "bg-subtle", text: "Stopped" }
        : { dot: "bg-moment", text: `${job.clips} short${job.clips === 1 ? "" : "s"}` };

  function save(value: string) {
    setEditing(false);
    const name = value.trim();
    if (name && name !== job.name) onRename(name);
  }

  return (
    <article className="group grid gap-2.5">
      <Link href={`/p/${job.id}`} className="relative block aspect-video overflow-hidden rounded-[14px] border bg-raised group-hover:border-border-strong">
        {job.cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- our own poster, or the YouTube thumbnail
          <img src={job.cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full place-items-center text-subtle">
            <FileVideo className="size-7" strokeWidth={1.5} aria-hidden="true" />
          </span>
        )}
        <span className="absolute top-2.5 left-2.5 inline-flex h-6 items-center gap-1.5 rounded-full bg-background/85 px-[9px] text-xs font-medium backdrop-blur-md">
          <i className={cn("size-[7px] rounded-full", chip.dot)} />
          {chip.text}
        </span>
        {dur && <span className="absolute right-2.5 bottom-2.5 rounded-md bg-background/85 px-[7px] font-mono text-xs font-medium">{dur}</span>}
        {running && (
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/12">
            <i className="block h-full bg-info transition-[width] duration-700" style={{ width: `${job.status.progress * 100}%` }} />
          </span>
        )}
      </Link>
      <div className="grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-0.5">
        {editing ? (
          <input
            autoFocus
            defaultValue={job.name}
            aria-label="Project name"
            onFocus={(e) => e.target.select()}
            onBlur={(e) => save(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
            className={field}
          />
        ) : (
          <Link href={`/p/${job.id}`} title={job.name} className="truncate text-[15px] font-semibold hover:underline">
            {job.name}
          </Link>
        )}
        <span className="relative col-start-2 row-span-2">
          <button type="button" onClick={() => setMenu((m) => !m)} aria-label="Project options" aria-expanded={menu} className={cn(btn, btnSm, btnGhost, btnIcon)}>
            <Ellipsis aria-hidden="true" />
          </button>
          <Menu open={menu} onClose={() => setMenu(false)} className="top-[calc(100%+6px)]">
            <MenuItem
              icon={<Pencil />}
              onClick={() => {
                setMenu(false);
                setEditing(true);
              }}
            >
              Rename
            </MenuItem>
            {job.url && (
              <MenuItem
                icon={<ExternalLink />}
                onClick={() => {
                  setMenu(false);
                  window.open(job.url, "_blank", "noopener");
                }}
              >
                Open source video
              </MenuItem>
            )}
            <MenuItem
              icon={<Trash2 />}
              danger
              onClick={() => {
                setMenu(false);
                onDelete();
              }}
            >
              Delete project
            </MenuItem>
          </Menu>
        </span>
        <small className="col-start-1 text-[13px] text-muted-foreground">
          {from}, {ago(job.created)}
        </small>
      </div>
    </article>
  );
}
