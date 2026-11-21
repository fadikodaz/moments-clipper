"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Check, ChevronLeft, Download, Ellipsis, ExternalLink, EyeOff, LoaderCircle, Pencil } from "lucide-react";
import { Menu, MenuItem, Toast, api, btn, btnCta, btnGhost, btnIcon, btnSm, field, formatTime, useToast } from "@/components/kit";
import type { EngineResult, JobMeta, ReviewMap, ReviewState } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { postCaption, toShorts, visibleShorts, type Short, type Sort } from "./model";
import { ShortCard } from "./parts";
import { EditorView } from "@/components/editor/editor-view";
import { WatchView, type Frame, type Tab } from "./watch-view";
import { qcIssue } from "./qc";
import { Seg } from "@/components/editor/tools";
import { useDialogs } from "@/components/ui/dialogs";

/** The open short lives in the URL hash (#watch=c03), so back/forward and reloads keep your place. */
function useHash() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    () => window.location.hash,
    () => "",
  );
}

type Props = { jobId: string; meta: JobMeta; result: EngineResult; initialReview: ReviewMap; notice: string | null; locked: boolean; onReload: () => void; frames: Frame[] };

export function ShortsView({ jobId, meta, result, initialReview, notice, locked, onReload, frames }: Props) {
  const shorts = useMemo(() => toShorts(jobId, result.clips), [jobId, result.clips]);
  const best = useMemo(() => Math.max(...shorts.map((s) => s.score)), [shorts]);
  const [review, setReview] = useState<ReviewMap>(initialReview);
  const [name, setName] = useState(meta.name);
  const [editingName, setEditingName] = useState(false);
  const [sort, setSort] = useState<Sort>("best");
  const [showHidden, setShowHidden] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toast = useToast();
  const dialogs = useDialogs();

  const hash = new URLSearchParams(useHash().slice(1));
  const watchId = hash.get("watch");
  const tabParam = hash.get("tab");
  const initialTab: Tab = tabParam === "why" ? "why" : "post";
  // Older links (#watch=c02&tab=edit) open the editor too.
  const editId = hash.get("edit") ?? (tabParam === "edit" ? watchId : null);
  const editing = editId ? shorts.find((s) => s.id === editId && review[s.id] !== "deleted") : undefined;
  const canFacecam = !!result.facecam || !["auto", "none", undefined].includes(result.layout);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [headMenu, setHeadMenu] = useState(false);
  const issues = visibleShorts(shorts, review, false, sort).filter((s) => qcIssue(s)).length;
  const list = visibleShorts(shorts, review, showHidden, sort).filter((s) => !onlyIssues || qcIssue(s));
  const shown = visibleShorts(shorts, review, false, sort);
  const hiddenCount = shorts.filter((s) => review[s.id] === "hidden").length;
  const watching = watchId ? shorts.find((s) => s.id === watchId && review[s.id] !== "deleted") : undefined;

  useEffect(() => {
    if (!watching) document.title = `${name} | Moments`;
  }, [watching, name]);

  const go = useCallback((id: string, tab?: string) => {
    window.location.hash = `watch=${id}${tab ? `&tab=${tab}` : ""}`;
    window.scrollTo({ top: 0 });
  }, []);
  const openEdit = useCallback((id: string) => {
    window.location.hash = `edit=${id}`;
    window.scrollTo({ top: 0 });
  }, []);
  const back = useCallback(() => {
    history.pushState(null, "", window.location.pathname);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, []);

  /** Updates the screen at once, then stores the choice; undoes it if storing fails. */
  const decide = useCallback(
    async (ids: string[], state: ReviewState | null, message: string) => {
      const before = review;
      const nextReview = { ...review };
      for (const id of ids) {
        if (state) nextReview[id] = state;
        else delete nextReview[id];
      }
      setReview(nextReview);
      toast.show(message);
      try {
        await api(`/api/jobs/${jobId}/review`, { method: "PUT", json: { clip: ids, state } });
      } catch {
        setReview(before);
        toast.show("Couldn't save that change. Is the app still running?");
      }
    },
    [review, jobId, toast],
  );

  const toggleHide = useCallback(
    (id: string) => {
      if (review[id] === "hidden") return decide([id], null, "Shown again");
      decide([id], "hidden", "Hidden. Find it under “hidden” above.");
      // In the watch view, hiding moves on to the next short.
      if (watchId === id) {
        const n = shown.findIndex((s) => s.id === id);
        const nextShort = shown[n + 1] ?? shown[n - 1];
        if (nextShort) go(nextShort.id);
        else back();
      }
    },
    [review, decide, watchId, shown, go, back],
  );

  const remove = useCallback(
    async (s: Short) => {
      if (!(await dialogs.confirm({ title: "Delete this short?", body: `“${s.title}” and its video file go from this computer.`, action: "Delete", cancel: "Keep it", danger: true }))) return;
      if (watchId === s.id) back();
      decide([s.id], "deleted", "Short deleted");
    },
    [decide, watchId, back, dialogs],
  );

  const copy = useCallback(
    async (s: Short) => {
      try {
        await navigator.clipboard.writeText(postCaption(s, meta.campaign));
        toast.show("Caption copied. Paste it when you post.");
      } catch {
        toast.show("Couldn't copy. Your browser blocked the clipboard.");
      }
    },
    [toast, meta.campaign],
  );

  async function saveName(value: string) {
    setEditingName(false);
    const next = value.trim();
    if (!next || next === name) return;
    const before = name;
    setName(next);
    try {
      await api(`/api/jobs/${jobId}`, { method: "PATCH", json: { name: next } });
      toast.show("Renamed");
    } catch (e) {
      setName(before);
      toast.show((e as Error).message);
    }
  }

  function endSelect() {
    setSelecting(false);
    setPicked(new Set());
  }
  useEffect(() => {
    if (!selecting) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && endSelect();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selecting]);

  const zip = (ids: string[]) => `/api/jobs/${jobId}/zip?clips=${ids.join(",")}`;

  if (editing) {
    return (
      <EditorView
        jobId={jobId}
        short={editing}
        total={shown.length}
        videoSec={result.sourceSec ?? result.durationSec}
        canFacecam={canFacecam}
        defaultCaptions={meta.options?.captions ?? "bold"}
        frames={frames}
        detected={result.facecam ? { x: result.facecam.x, y: result.facecam.y, w: result.facecam.w, h: result.facecam.h } : null}
        locked={locked}
        campaign={meta.campaign ?? undefined}
        onBack={() => go(editing.id)}
        onChanged={onReload}
      />
    );
  }

  if (watching) {
    return (
      <div className="mx-auto max-w-[1320px] px-3.5 pt-[18px] pb-[130px] md:px-8 md:pt-8 md:pb-[120px]">
        <WatchView
          key={watching.id}
          jobId={jobId}
          projectName={name}
          initialTab={initialTab}
          locked={locked}
          onEdit={(s) => openEdit(s.id)}
          toast={toast.show}
          campaign={meta.campaign}
          short={watching}
          list={shown.some((s) => s.id === watching.id) ? shown : list}
          best={best}
          hidden={review[watching.id] === "hidden"}
          onGo={go}
          onBack={back}
          onHide={toggleHide}
          onCopy={copy}
          onDelete={remove}
          onChanged={onReload}
        />
        <Toast msg={toast.msg} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1180px] px-3.5 pt-[18px] pb-[130px] md:px-8 md:pt-8 md:pb-[120px]">
      <Link href="/projects" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden="true" /> All projects
      </Link>

      <div className="mt-2.5 mb-6 flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          {editingName ? (
            <input
              autoFocus
              defaultValue={name}
              aria-label="Project name"
              onFocus={(e) => e.target.select()}
              onBlur={(e) => saveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditingName(false);
              }}
              className={cn(field, "h-[46px] w-[min(560px,80vw)] text-[22px] font-semibold")}
            />
          ) : (
            <h1 className="max-w-[28ch] text-[24px] leading-[1.15] font-bold tracking-[-0.025em] md:text-[30px]">{name}</h1>
          )}
          <p className="mt-1.5 text-sm text-muted-foreground">
            {meta.url ? "From YouTube" : "Uploaded recording"}, {formatTime(result.durationSec)}
          </p>
        </div>
        <div className="relative flex gap-2 max-md:w-full max-md:[&>a]:flex-1">
          {selecting ? (
            <button type="button" onClick={endSelect} className={cn(btn, btnGhost)}>
              Cancel
            </button>
          ) : (
            <>
              {shown.length > 0 && (
                <a href={zip(shown.map((s) => s.id))} className={cn(btn, btnCta)}>
                  <Download aria-hidden="true" /> Download all {shown.length}
                </a>
              )}
              <span className="relative">
                <button type="button" onClick={() => setHeadMenu((m) => !m)} aria-label="Project options" aria-expanded={headMenu} className={cn(btn, btnIcon, "w-10")}>
                  <Ellipsis aria-hidden="true" />
                </button>
                <Menu open={headMenu} onClose={() => setHeadMenu(false)} className="top-[calc(100%+6px)] right-0">
                  <MenuItem icon={<Pencil />} onClick={() => { setHeadMenu(false); setEditingName(true); }}>
                    Rename
                  </MenuItem>
                  {meta.url && (
                    <MenuItem icon={<ExternalLink />} onClick={() => { setHeadMenu(false); window.open(meta.url!, "_blank", "noopener"); }}>
                      Open on YouTube
                    </MenuItem>
                  )}
                  {shown.length > 1 && (
                    <MenuItem icon={<Check />} onClick={() => { setHeadMenu(false); setSelecting(true); }}>
                      Select several
                    </MenuItem>
                  )}
                </Menu>
              </span>
            </>
          )}
        </div>
      </div>

      {notice && (
        <div role="status" className="mb-5 flex items-center gap-2.5 rounded-xl border bg-panel px-3.5 py-2.5 text-[13px] text-muted-foreground">
          {notice.includes("appear here") && <LoaderCircle className="size-4 shrink-0 animate-spin text-foreground" aria-hidden="true" />}
          {notice}
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          <Chip on={!showHidden && !onlyIssues} onClick={() => { setShowHidden(false); setOnlyIssues(false); }} label="All" n={shown.length} />
          {issues > 0 && <Chip on={onlyIssues} onClick={() => { setShowHidden(false); setOnlyIssues(true); }} label="Needs a look" n={issues} dot="bg-warn" />}
          {hiddenCount > 0 && <Chip on={showHidden} onClick={() => { setOnlyIssues(false); setShowHidden(true); }} label="Hidden" n={hiddenCount} />}
        </div>
        <Seg label="Order" value={sort} onChange={setSort} options={[["best", "Best first"], ["time", "Video order"]]} />
      </div>

      {list.length ? (
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] md:gap-x-[18px] md:gap-y-7">
          {list.map((s) => (
            <ShortCard
              key={s.id}
              short={s}
              best={best}
              hidden={review[s.id] === "hidden"}
              selecting={selecting}
              selected={picked.has(s.id)}
              onOpen={() => {
                if (!selecting) return go(s.id);
                setPicked((p) => {
                  const n = new Set(p);
                  if (n.has(s.id)) n.delete(s.id);
                  else n.add(s.id);
                  return n;
                });
              }}
              onEdit={() => openEdit(s.id)}
              onCopy={() => copy(s)}
              onHide={() => toggleHide(s.id)}
              onDelete={() => remove(s)}
            />
          ))}
        </div>
      ) : (
        <p className="py-[50px] text-center text-muted-foreground">{showHidden ? "Nothing hidden." : onlyIssues ? "Every short passed the check." : "Every short is hidden."}</p>
      )}

      {selecting && (
        <div className="fixed bottom-[72px] left-1/2 z-30 flex w-[calc(100%-20px)] -translate-x-1/2 items-center justify-between gap-3 rounded-2xl border border-border-strong bg-raised py-2.5 pr-2.5 pl-[18px] whitespace-nowrap shadow-[0_20px_60px_rgb(0_0_0/0.6)] md:bottom-5 md:ml-[110px] md:w-auto md:justify-start">
          <span>{picked.size ? <><b>{picked.size}</b> selected</> : "Tap shorts to select them"}</span>
          <span className="flex gap-2">
            <button
              type="button"
              disabled={!picked.size}
              onClick={() => {
                decide([...picked], showHidden ? null : "hidden", showHidden ? `${picked.size} shown again` : `${picked.size} hidden`);
                endSelect();
              }}
              className={cn(btn, btnSm, btnGhost)}
            >
              <EyeOff aria-hidden="true" /> {showHidden ? "Show again" : "Hide"}
            </button>
            {picked.size ? (
              <a href={zip([...picked])} onClick={() => setTimeout(endSelect, 100)} className={cn(btn, btnSm, btnCta)}>
                <Download aria-hidden="true" /> Download {picked.size}
              </a>
            ) : (
              <button type="button" disabled className={cn(btn, btnSm, btnCta)}>
                <Download aria-hidden="true" /> Download
              </button>
            )}
          </span>
        </div>
      )}

      <Toast msg={toast.msg} raised={selecting} />
    </div>
  );
}

function Chip({ on, onClick, label, n, dot }: { on: boolean; onClick: () => void; label: string; n: number; dot?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold text-muted-foreground hover:border-border-strong hover:text-foreground",
        on && "border-foreground bg-foreground text-background hover:border-foreground hover:text-background",
      )}
    >
      {dot && <i className={cn("size-[7px] rounded-full", dot)} aria-hidden="true" />}
      {label} <b className={cn("font-bold text-foreground", on && "text-background")}>{n}</b>
    </button>
  );
}
