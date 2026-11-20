"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Check, ChevronLeft, Download, ExternalLink, EyeOff, LoaderCircle, Pencil } from "lucide-react";
import { Toast, ago, api, btn, btnCta, btnGhost, btnIcon, btnPrimary, btnSm, field, formatTime, useToast } from "@/components/kit";
import type { EngineResult, JobMeta, ReviewMap, ReviewState } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { postCaption, toShorts, visibleShorts, type Short, type Sort } from "./model";
import { ShortCard } from "./parts";
import { WatchView, type Frame, type Tab } from "./watch-view";

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

  const hash = new URLSearchParams(useHash().slice(1));
  const watchId = hash.get("watch");
  const tabParam = hash.get("tab");
  const initialTab: Tab = tabParam === "edit" || tabParam === "why" ? tabParam : "post";
  const canFacecam = !!result.facecam || !["auto", "none", undefined].includes(result.layout);
  const list = visibleShorts(shorts, review, showHidden, sort);
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
    (s: Short) => {
      if (!confirm(`Delete "${s.title}"? This can't be undone.`)) return;
      if (watchId === s.id) back();
      decide([s.id], "deleted", "Short deleted");
    },
    [decide, watchId, back],
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

  if (watching) {
    return (
      <div className="mx-auto max-w-[1320px] px-3.5 pt-[18px] pb-[130px] md:px-8 md:pt-8 md:pb-[120px]">
        <WatchView
          key={watching.id}
          jobId={jobId}
          projectName={name}
          initialTab={initialTab}
          videoSec={result.durationSec}
          canFacecam={canFacecam}
          defaultCaptions={meta.options?.captions ?? "bold"}
          locked={locked}
          onChanged={onReload}
          toast={toast.show}
          campaign={meta.campaign}
          frames={frames}
          detected={result.facecam ? { x: result.facecam.x, y: result.facecam.y, w: result.facecam.w, h: result.facecam.h } : null}
          short={watching}
          list={shown.some((s) => s.id === watching.id) ? shown : list}
          best={best}
          hidden={review[watching.id] === "hidden"}
          onGo={go}
          onBack={back}
          onHide={toggleHide}
          onCopy={copy}
          onDelete={remove}
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

      <div className="mt-2.5 mb-[26px] flex flex-wrap items-end justify-between gap-5">
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
            <div className="group/name flex items-center gap-1.5">
              <h1 className="text-[22px] leading-[1.15] font-[650] tracking-[-0.035em] md:text-[30px]">{name}</h1>
              <button
                type="button"
                onClick={() => setEditingName(true)}
                aria-label="Rename project"
                className={cn(btn, btnSm, btnGhost, btnIcon, "opacity-0 group-hover/name:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100")}
              >
                <Pencil aria-hidden="true" />
              </button>
            </div>
          )}
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            {meta.url ? (
              <a href={meta.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-foreground">
                <ExternalLink className="size-[15px]" aria-hidden="true" /> Open on YouTube
              </a>
            ) : (
              <span>Uploaded file</span>
            )}
            <span>{formatTime(result.durationSec)} long</span>
            <span>Made {ago(meta.created)}</span>
          </p>
        </div>
        <div className="flex gap-2 max-md:w-full max-md:[&>*]:flex-1">
          {selecting ? (
            <button type="button" onClick={endSelect} className={cn(btn, btnGhost)}>
              Cancel
            </button>
          ) : (
            <>
              <button type="button" onClick={() => setSelecting(true)} disabled={!shown.length} className={btn}>
                <Check aria-hidden="true" /> Select
              </button>
              {shown.length > 0 && (
                <a href={zip(shown.map((s) => s.id))} className={cn(btn, btnPrimary)}>
                  <Download aria-hidden="true" /> Download all {shown.length}
                </a>
              )}
            </>
          )}
        </div>
      </div>

      {notice && (
        <div role="status" className="mb-5 flex items-center gap-2.5 rounded-xl border bg-panel px-3.5 py-2.5 text-[13px] text-muted-foreground">
          {notice.includes("appear here") && <LoaderCircle className="size-4 shrink-0 animate-spin text-moment" aria-hidden="true" />}
          {notice}
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-muted-foreground">
            {showHidden ? (
              <>
                <b className="font-semibold text-foreground">{hiddenCount}</b> hidden{" "}
                <button type="button" onClick={() => setShowHidden(false)} className="ml-1 text-[13px] underline decoration-border-strong underline-offset-[3px] hover:text-foreground">
                  Back to all shorts
                </button>
              </>
            ) : (
              <>
                <b className="font-semibold text-foreground">{shown.length}</b> shorts
                {hiddenCount > 0 && (
                  <button type="button" onClick={() => setShowHidden(true)} className="ml-2 text-[13px] underline decoration-border-strong underline-offset-[3px] hover:text-foreground">
                    {hiddenCount} hidden
                  </button>
                )}
              </>
            )}
          </span>
          <label htmlFor="sort" className="sr-only">
            Sort shorts
          </label>
          <select id="sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={cn(field, "h-[34px] w-auto")}>
            <option value="best">Best first</option>
            <option value="time">In video order</option>
          </select>
        </div>
        <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
          What&apos;s the score?
          <span tabIndex={0} className="group/tip relative inline-grid size-[18px] cursor-help place-items-center rounded-full border border-border-strong text-[11px] font-semibold text-subtle">
            ?
            <span
              role="tooltip"
              className="pointer-events-none absolute right-0 bottom-[calc(100%+8px)] z-30 w-[260px] rounded-[10px] border border-border-strong bg-raised px-3 py-2.5 text-left text-xs leading-[1.45] font-normal text-muted-foreground opacity-0 transition-opacity group-hover/tip:opacity-100 group-focus/tip:opacity-100 md:right-auto md:left-1/2 md:-translate-x-1/2"
            >
              How likely this moment works as a short, judged by AI from what was said and how intense the moment is. 80+ is a strong pick, 70+ is good.
            </span>
          </span>
        </span>
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
              onEdit={() => go(s.id, "edit")}
              onCopy={() => copy(s)}
              onHide={() => toggleHide(s.id)}
              onDelete={() => remove(s)}
            />
          ))}
        </div>
      ) : (
        <p className="py-[50px] text-center text-muted-foreground">{showHidden ? "Nothing hidden." : "Every short is hidden. Click “hidden” above to see them."}</p>
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
