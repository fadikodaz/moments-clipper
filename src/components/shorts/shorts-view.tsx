"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Download } from "lucide-react";
import type { EngineClip, ReviewMap, ReviewState } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { toShorts, visibleShorts, type Filter, type Sort } from "./model";
import { ShortCard, btn, btnSm } from "./parts";
import { WatchView } from "./watch-view";

/** The open short lives in the URL hash (#watch=c03), so back/forward and reloads keep your place. */
function useWatchId() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    () => new URLSearchParams(window.location.hash.slice(1)).get("watch"),
    () => null,
  );
}

function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2400);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { msg, show };
}

type Props = { jobId: string; title: string; clips: EngineClip[]; initialReview: ReviewMap; banner?: ReactNode };

export function ShortsView({ jobId, title, clips, initialReview, banner }: Props) {
  const shorts = useMemo(() => toShorts(jobId, clips), [jobId, clips]);
  const best = useMemo(() => Math.max(...shorts.map((s) => s.score)), [shorts]);
  const [review, setReview] = useState<ReviewMap>(initialReview);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("best");
  const watchId = useWatchId();
  const toast = useToast();

  const list = visibleShorts(shorts, review, filter, sort);
  const count = (s: ReviewState) => shorts.filter((x) => review[x.id] === s).length;
  const saved = shorts.filter((s) => review[s.id] === "saved");
  const hiddenCount = count("hidden");
  const watching = watchId ? shorts.find((s) => s.id === watchId) : undefined;

  const go = useCallback((id: string) => {
    window.location.hash = `watch=${id}`;
    window.scrollTo({ top: 0 });
  }, []);
  const back = useCallback(() => {
    history.pushState(null, "", window.location.pathname);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, []);

  /** Updates the screen at once, then stores the choice; undoes it if storing fails. */
  const decide = useCallback(
    async (id: string, state: ReviewState | null, message: string) => {
      const before = review;
      const nextReview = { ...review };
      if (state) nextReview[id] = state;
      else delete nextReview[id];
      setReview(nextReview);
      toast.show(message);
      const r = await fetch(`/api/jobs/${jobId}/review`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clip: id, state }) }).catch(() => null);
      if (!r?.ok) {
        setReview(before);
        toast.show("Couldn't save that change. Is the app still running?");
      }
    },
    [review, jobId, toast],
  );

  const toggleSave = useCallback(
    (id: string) => (review[id] === "saved" ? decide(id, null, "Removed from saved.") : decide(id, "saved", "Saved. Download all saved shorts from the bar below.")),
    [review, decide],
  );
  const toggleHide = useCallback(
    (id: string) => {
      if (review[id] === "hidden") return decide(id, null, "Shown again.");
      decide(id, "hidden", "Hidden. Find it under Hidden.");
      // In the watch view, hiding moves on to the next short.
      if (watchId === id) {
        const n = list.findIndex((s) => s.id === id);
        const nextShort = list[n + 1] ?? list[n - 1];
        if (nextShort) go(nextShort.id);
        else back();
      }
    },
    [review, decide, watchId, list, go, back],
  );

  const tab = (f: Filter, label: string, n: number) => (
    <button
      type="button"
      onClick={() => setFilter(f)}
      aria-pressed={filter === f}
      className={cn("rounded-[9px] px-3.5 py-[7px] font-medium text-muted-foreground", filter === f && "bg-raised text-foreground")}
    >
      {label}
      <b className="ml-1.5 font-mono text-xs font-semibold text-subtle">{n}</b>
    </button>
  );

  return (
    <div className="mx-auto max-w-[1320px] px-3 pt-4 pb-28 text-sm sm:px-6 sm:pt-[22px]">
      {banner}

      {watching ? (
        <WatchView
          short={watching}
          list={list.some((s) => s.id === watching.id) ? list : shorts}
          best={best}
          review={review}
          onGo={go}
          onBack={back}
          onSave={toggleSave}
          onHide={toggleHide}
        />
      ) : (
        <>
          <div className="mb-[18px] flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[26px] font-[650] tracking-[-0.03em]">{title}</h1>
              <p className="mt-1 text-muted-foreground">
                <span className="max-sm:hidden [@media(hover:none)]:hidden">Hover to preview, click to watch.</span>
                <span className="hidden max-sm:inline [@media(hover:none)]:inline">Tap a short to watch it.</span> Download the ones you like, or save them for later.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex gap-1 rounded-xl border bg-panel p-1" role="group" aria-label="Show">
                {tab("all", "All", shorts.length - hiddenCount)}
                {tab("saved", "Saved", saved.length)}
                {(hiddenCount > 0 || filter === "hidden") && tab("hidden", "Hidden", hiddenCount)}
              </div>
              <label htmlFor="sort" className="sr-only">
                Sort shorts
              </label>
              <select id="sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-10 rounded-xl border bg-panel px-3 text-sm outline-none hover:border-border-strong">
                <option value="best">Best first</option>
                <option value="time">In video order</option>
              </select>
            </div>
          </div>

          {list.length ? (
            <div className="grid grid-cols-2 gap-x-2.5 gap-y-[18px] sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] sm:gap-x-[18px] sm:gap-y-[26px]">
              {list.map((s) => (
                <ShortCard
                  key={s.id}
                  short={s}
                  best={best}
                  saved={review[s.id] === "saved"}
                  hidden={review[s.id] === "hidden"}
                  onOpen={() => go(s.id)}
                  onSave={() => toggleSave(s.id)}
                  onHide={() => toggleHide(s.id)}
                />
              ))}
            </div>
          ) : (
            <p className="py-16 text-center text-muted-foreground">
              {filter === "saved" ? "Nothing saved yet. Tap the heart on a short to save it." : filter === "hidden" ? "Nothing hidden." : "Every short is hidden. Check the Hidden tab."}
            </p>
          )}
        </>
      )}

      {saved.length > 0 && (
        <div className="fixed bottom-[70px] left-1/2 z-30 flex w-[calc(100%-20px)] -translate-x-1/2 items-center justify-between gap-3.5 rounded-2xl border border-border-strong bg-raised py-2.5 pr-2.5 pl-[18px] whitespace-nowrap shadow-[0_20px_60px_rgb(0_0_0/0.6)] sm:bottom-[18px] sm:w-auto">
          <span className="flex">
            {saved.slice(0, 5).map((s, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- poster served by our own route
              <img key={s.id} src={s.posterUrl} alt="" className={cn("h-[46px] w-[26px] rounded-[5px] border-2 border-raised object-cover", i > 0 && "-ml-2")} />
            ))}
          </span>
          <span>
            <b>{saved.length}</b> saved
          </span>
          <a href={`/api/jobs/${jobId}/zip?clips=${saved.map((s) => s.id).join(",")}`} className={cn(btn, btnSm, "border-moment bg-moment text-moment-ink hover:bg-moment hover:brightness-110")}>
            <Download aria-hidden="true" />
            Download {saved.length} saved
          </a>
        </div>
      )}

      <div aria-live="polite" className={cn("pointer-events-none fixed left-1/2 z-50 -translate-x-1/2", saved.length ? "bottom-[140px] sm:bottom-[92px]" : "bottom-[80px] sm:bottom-6")}>
        {toast.msg && <p className="rounded-xl bg-foreground px-4 py-2.5 text-[13px] font-medium whitespace-nowrap text-background shadow-lg">{toast.msg}</p>}
      </div>
    </div>
  );
}
