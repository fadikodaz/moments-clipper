"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, LayoutGrid, List, Pencil, Search, X } from "lucide-react";
import { ClipThumb } from "./clip-thumb";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { CAPTION_STYLES, LAYOUTS, SEARCH_ALIASES, formatDuration, type CaptionStyle, type Clip, type ClipLayout, type Project } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { ClipInfo, controlClass } from "./clip-detail";
import { ClipPreview } from "./clip-preview";
import { useReview } from "./review-store";
import { scoreTier, type ClipPatch, type ReviewClip } from "./types";

type Sort = "score" | "time" | "length";
type SearchTab = { id: string; label: string; ids: string[] };
type Filter = { kind: "all" } | { kind: "status"; value: "new" | "kept" } | { kind: "tag"; value: string };

const DESKTOP = "(min-width: 1024px)";

function matchClips(query: string, all: Clip[]) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const tags = words.map((w) => Object.keys(SEARCH_ALIASES).find((k) => w.startsWith(k))).filter((k): k is string => !!k).map((k) => SEARCH_ALIASES[k]);
  return all.filter((c) => tags.some((t) => c.tags.includes(t)) || words.some((w) => w.length > 3 && c.title.toLowerCase().includes(w))).map((c) => c.id);
}

function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string) => {
    setMsg(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { msg, show };
}

const iconBtn = "grid size-[26px] place-items-center rounded-[5px] text-muted-foreground hover:text-foreground";
const smallBtn = "inline-flex h-7 items-center gap-1.5 rounded-md border bg-raised px-2.5 text-xs font-medium whitespace-nowrap hover:bg-hover disabled:opacity-40";

export function ClipsInbox({ project }: { project: Project }) {
  const router = useRouter();
  const { clips, patch, patchMany } = useReview();
  const source = clips;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [currentId, setCurrentId] = useState<string | undefined>(undefined);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [view, setView] = useState<"list" | "grid">("list");
  const [sort, setSort] = useState<Sort>("score");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [tabs, setTabs] = useState<SearchTab[]>([]);
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [bulkLayout, setBulkLayout] = useState<ClipLayout>("follow");
  const [bulkCaption, setBulkCaption] = useState<CaptionStyle>("bold");
  const toast = useToast();
  const listRef = useRef<HTMLDivElement>(null);

  // Only tags shared by 2+ clips become filters; one-off tags would just add noise.
  const tags = useMemo(() => {
    const count = new Map<string, number>();
    source.forEach((c) => c.tags.forEach((t) => count.set(t, (count.get(t) ?? 0) + 1)));
    return [...count].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [source]);
  const kept = clips.filter((c) => c.status === "kept").length;
  const undecided = clips.filter((c) => c.status === "new").length;

  const list = useMemo(() => {
    const t = tabs.find((x) => x.id === tab);
    let out = t ? clips.filter((c) => t.ids.includes(c.id)) : clips.slice();
    if (filter.kind === "status") out = out.filter((c) => c.status === filter.value);
    if (filter.kind === "tag") out = out.filter((c) => c.tags.includes(filter.value));
    return out.sort((a, b) => (sort === "score" ? b.score - a.score : sort === "time" ? a.startSec - b.startSec : a.durSec - b.durSec));
  }, [clips, tabs, tab, filter, sort]);

  const current = list.find((c) => c.id === currentId) ?? list[0];

  /** Mark a clip and move to the next undecided one, so review is one key per clip. */
  const decide = useCallback(
    (id: string, status: "kept" | "removed") => {
      const k = list.findIndex((c) => c.id === id);
      const target = clips.find((c) => c.id === id);
      const next = target?.status === status ? "new" : status; // pressing again undoes
      patch(id, { status: next });
      if (next !== "new") {
        const after = list.slice(k + 1).find((c) => c.status === "new");
        if (after) setCurrentId(after.id);
      }
    },
    [clips, list, patch],
  );

  const select = useCallback((id: string) => {
    setCurrentId(id);
    if (!window.matchMedia(DESKTOP).matches) setSheetOpen(true);
  }, []);

  // Keyboard review: arrows or J/K move, A keeps, X removes, Enter opens the editor.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (view !== "list" || sheetOpen || !current) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("input, select, textarea, [role=dialog]")) return;
      const k = list.findIndex((c) => c.id === current.id);
      const move = (d: number) => {
        const n = list[k + d];
        if (!n) return;
        e.preventDefault();
        setCurrentId(n.id);
        listRef.current?.querySelector<HTMLElement>(`[data-id="${n.id}"]`)?.scrollIntoView({ block: "nearest" });
      };
      const key = e.key.toLowerCase();
      if (key === "arrowdown" || key === "j") move(1);
      else if (key === "arrowup" || key === "k") move(-1);
      else if (key === "a") decide(current.id, "kept");
      else if (key === "x") decide(current.id, "removed");
      else if (key === "enter") {
        // Only when nothing else has focus or a clip row has focus, so buttons and links keep their own Enter.
        const t = e.target as HTMLElement;
        if (!current.videoUrl && (t === document.body || t.closest("[data-row]"))) router.push(`/clips/${current.id}/edit`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, sheetOpen, current, list, decide, router]);

  function toggleSelect(id: string, on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  function bulk(action: "all" | "keep" | "remove" | "layout" | "caption" | "clear") {
    const ids = [...selected];
    if (action === "all") return setSelected(new Set(list.map((c) => c.id)));
    if (action === "clear") return setSelected(new Set());
    const p: ClipPatch =
      action === "keep" ? { status: "kept" } : action === "remove" ? { status: "removed" } : action === "layout" ? { layout: bulkLayout } : { caption: bulkCaption };
    patchMany(ids, p);
    if (action === "keep" || action === "remove") {
      setSelected(new Set());
      toast.show(`${action === "keep" ? "Kept" : "Removed"} ${ids.length} ${ids.length === 1 ? "clip" : "clips"}`);
    } else {
      toast.show(`Applied to ${ids.length} ${ids.length === 1 ? "clip" : "clips"}`);
    }
  }

  function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const ids = matchClips(q, source);
    if (!ids.length) return toast.show("Nothing matched. Try \u201cpolice chase\u201d or \u201cfunny\u201d.");
    const id = `q${tabs.length + 1}-${q}`;
    setTabs((t) => [...t, { id, label: `\u201c${q}\u201d`, ids }]);
    setTab(id);
    setFilter({ kind: "all" });
    setQuery("");
    toast.show(`Found ${ids.length} matching ${ids.length === 1 ? "moment" : "moments"}`);
  }

  function closeTab(id: string) {
    setTabs((t) => t.filter((x) => x.id !== id));
    if (tab === id) setTab("all");
  }

  const chip = (active: boolean) =>
    cn("h-6 shrink-0 rounded-md px-2.5 text-[11px] font-medium", active ? "bg-foreground text-background" : "bg-raised text-muted-foreground hover:text-foreground");

  return (
    <div className="flex flex-col px-3.5 pt-4 pb-6 sm:px-7 sm:pt-[22px] lg:h-full lg:pb-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-[-0.015em]">{project.title}</h1>
          <p className="text-xs text-muted-foreground">
            {project.game}, {formatDuration(project.durationSec)}, {source.length} clips
            {undecided > 0 ? `, ${undecided} not decided` : ", all reviewed"}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" className={smallBtn} disabled title="Re-running a project arrives with processing">
            Re-run
          </button>
          {kept > 0 ? (
            <Link href="/schedule" className="inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-xs font-semibold text-background hover:bg-[#e4e4e7]">
              Schedule <span className="font-mono">{kept}</span>
            </Link>
          ) : (
            <span className={cn(smallBtn, "cursor-not-allowed opacity-40")} aria-disabled="true" title="Keep at least one clip first">
              Schedule <span className="font-mono">0</span>
            </span>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b pb-2">
        <form onSubmit={runSearch} className="flex h-[30px] w-full items-center gap-2 rounded-md border bg-panel pr-1 pl-2.5 text-muted-foreground sm:w-[280px]">
          <Search className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={"Find a moment\u2026"}
            aria-label="Find a moment"
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-subtle"
          />
          <button type="submit" className="h-[22px] rounded-[5px] border bg-raised px-2 text-[11px]">
            Find
          </button>
        </form>

        <div role="tablist" aria-label="Clip sets" className="flex min-w-0 gap-4 overflow-x-auto">
          {[{ id: "all", label: "All", ids: source.map((c) => c.id) }, ...tabs].map((t) => (
            <span key={t.id} className="flex shrink-0 items-center">
              <button
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn("border-b-2 py-1.5 text-[13px] font-medium", tab === t.id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
              >
                {t.label}
                <span className="ml-1 font-mono text-[11px] text-subtle">{t.ids.length}</span>
              </button>
              {t.id !== "all" && (
                <button type="button" onClick={() => closeTab(t.id)} aria-label={`Close ${t.label}`} className="ml-1 text-subtle hover:text-foreground">
                  <X className="size-3" />
                </button>
              )}
            </span>
          ))}
        </div>

        <span className="hidden flex-1 sm:block" />
        <div className="ml-auto flex items-center gap-2">
          <select aria-label="Sort clips" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={cn(controlClass, "w-auto")}>
            <option value="score">Score</option>
            <option value="time">Timeline</option>
            <option value="length">Length</option>
          </select>
          <div role="group" aria-label="View" className="inline-flex rounded-md border p-0.5">
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} title="List and preview" className={cn(iconBtn, view === "list" && "bg-raised text-foreground")}>
              <List className="size-4" strokeWidth={1.75} />
            </button>
            <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")} title="Grid" className={cn(iconBtn, view === "grid" && "bg-raised text-foreground")}>
              <LayoutGrid className="size-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-2.5 flex flex-wrap gap-1.5" aria-label="Filter clips">
        <button type="button" aria-pressed={filter.kind === "all"} onClick={() => setFilter({ kind: "all" })} className={chip(filter.kind === "all")}>
          Everything
        </button>
        <button type="button" aria-pressed={filter.kind === "status" && filter.value === "new"} onClick={() => setFilter({ kind: "status", value: "new" })} className={chip(filter.kind === "status" && filter.value === "new")}>
          Not decided
        </button>
        <button type="button" aria-pressed={filter.kind === "status" && filter.value === "kept"} onClick={() => setFilter({ kind: "status", value: "kept" })} className={chip(filter.kind === "status" && filter.value === "kept")}>
          Kept
        </button>
        {tags.map((t) => (
          <button key={t} type="button" aria-pressed={filter.kind === "tag" && filter.value === t} onClick={() => setFilter({ kind: "tag", value: t })} className={chip(filter.kind === "tag" && filter.value === t)}>
            {t}
          </button>
        ))}
      </div>

      {/* Body */}
      {!list.length ? (
        <p className="py-10 text-center text-muted-foreground">No clips match. Clear the filter or search again.</p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] content-start gap-x-3 gap-y-4 overflow-y-auto lg:min-h-0 lg:flex-1 lg:grid-cols-[repeat(auto-fill,minmax(150px,170px))]">
          {list.map((c) => (
            <GridCard key={c.id} clip={c} checked={selected.has(c.id)} onCheck={(on) => toggleSelect(c.id, on)} onDecide={(s) => decide(c.id, s)} />
          ))}
        </div>
      ) : (
        <div className="grid overflow-hidden rounded-lg border lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(320px,400px)_1fr]">
          <div ref={listRef} role="listbox" aria-label="Clips" className="overflow-y-auto lg:border-r">
            {list.map((c) => (
              <ClipRow
                key={c.id}
                clip={c}
                current={c.id === current?.id}
                checked={selected.has(c.id)}
                onCheck={(on) => toggleSelect(c.id, on)}
                onSelect={() => select(c.id)}
              />
            ))}
          </div>
          {current && (
            <div className="@container hidden overflow-y-auto p-[18px] lg:block">
              <div className="mx-auto grid max-w-[720px] gap-[22px] @[600px]:grid-cols-[auto_minmax(240px,380px)]">
                <ClipPreview clip={current} className="mx-auto h-[min(560px,calc(100dvh-290px))] min-h-[360px]" />
                <ClipInfo clip={current} onPatch={(p) => patch(current.id, p)} onDecide={(s) => decide(current.id, s)} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Phone / tablet detail */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl p-4 pt-10">
          <SheetTitle className="sr-only">{current?.title ?? "Clip"}</SheetTitle>
          <SheetDescription className="sr-only">Preview, keep or remove this clip</SheetDescription>
          {current && (
            <div className="mx-auto grid w-full max-w-[560px] gap-4 sm:grid-cols-[200px_1fr]">
              <ClipPreview clip={current} className="mx-auto w-[min(200px,55vw)]" />
              <ClipInfo clip={current} onPatch={(p) => patch(current.id, p)} onDecide={(s) => decide(current.id, s)} />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div
          role="toolbar"
          aria-label="Selected clips"
          className="fixed bottom-[66px] left-1/2 z-30 flex w-[calc(100%-20px)] -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-lg border border-border-strong bg-raised py-1.5 pr-2 pl-3 text-xs shadow-[0_20px_50px_rgb(0_0_0/0.6)] sm:bottom-[18px] sm:w-auto sm:flex-nowrap"
        >
          <span className="mr-1 whitespace-nowrap">
            <b>{selected.size}</b> selected
          </span>
          <button type="button" className={smallBtn} onClick={() => bulk("all")}>
            Select all
          </button>
          <button type="button" className={smallBtn} onClick={() => bulk("keep")}>
            Keep
          </button>
          <button type="button" className={smallBtn} onClick={() => bulk("remove")}>
            Remove
          </button>
          <span className="mx-1 hidden h-[18px] w-px bg-border-strong sm:block" />
          <select aria-label="Layout for selected" value={bulkLayout} onChange={(e) => setBulkLayout(e.target.value as ClipLayout)} className={cn(controlClass, "h-7 w-auto")}>
            {LAYOUTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button type="button" className={smallBtn} onClick={() => bulk("layout")}>
            Apply
          </button>
          <select aria-label="Captions for selected" value={bulkCaption} onChange={(e) => setBulkCaption(e.target.value as CaptionStyle)} className={cn(controlClass, "h-7 w-auto")}>
            {CAPTION_STYLES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" className={smallBtn} onClick={() => bulk("caption")}>
            Apply
          </button>
          <button type="button" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => bulk("clear")}>
            Cancel
          </button>
        </div>
      )}

      <div aria-live="polite" className="pointer-events-none fixed bottom-[124px] left-1/2 z-50 -translate-x-1/2 sm:bottom-[70px]">
        {toast.msg && <p className="rounded-lg bg-foreground px-3.5 py-2 text-xs font-medium text-background shadow-lg">{toast.msg}</p>}
      </div>
    </div>
  );
}

function StatusTag({ status }: { status: ReviewClip["status"] }) {
  if (status === "new") return null;
  return (
    <span className={cn("rounded-full border px-1.5 text-[10px]", status === "kept" ? "border-good/40 text-good" : "text-muted-foreground")}>
      {status === "kept" ? "Kept" : "Removed"}
    </span>
  );
}

function ClipRow({ clip, current, checked, onCheck, onSelect }: { clip: ReviewClip; current: boolean; checked: boolean; onCheck: (on: boolean) => void; onSelect: () => void }) {
  const top = scoreTier(clip.score).top;
  return (
    <div
      data-row
      data-id={clip.id}
      role="option"
      aria-selected={current}
      tabIndex={current ? 0 : -1}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("input")) return;
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "grid cursor-pointer grid-cols-[18px_34px_1fr_auto] items-center gap-2.5 border-b px-3 py-2 last:border-b-0 hover:bg-panel",
        current && "bg-raised shadow-[inset_2px_0_0_var(--moment)] hover:bg-raised",
        clip.status === "removed" && "opacity-45",
      )}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Select ${clip.title}`} className="accent-moment" />
      <span className="block h-[60px] w-[34px] overflow-hidden rounded-[5px]">
        <ClipThumb clip={clip} />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{clip.title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{clip.tags.join(", ")}</span>
        <span className="block font-mono text-[11px] text-subtle">
          {formatDuration(clip.startSec)}, {clip.durSec}s
        </span>
      </span>
      <span className="grid justify-items-end gap-1">
        <span className={cn("font-mono font-medium", top && "text-moment")}>{clip.score}</span>
        <StatusTag status={clip.status} />
      </span>
    </div>
  );
}

function GridCard({ clip, checked, onCheck, onDecide }: { clip: ReviewClip; checked: boolean; onCheck: (on: boolean) => void; onDecide: (s: "kept" | "removed") => void }) {
  const top = scoreTier(clip.score).top;
  return (
    <article className={cn("relative grid content-start gap-1.5", clip.status === "removed" && "opacity-45")}>
      <Link
        href={clip.videoUrl ?? `/clips/${clip.id}/edit`}
        target={clip.videoUrl ? "_blank" : undefined}
        aria-label={clip.videoUrl ? `Play ${clip.title}` : `Edit ${clip.title}`}
        className={cn("block aspect-[9/16] overflow-hidden rounded-[10px] border bg-black", clip.status === "kept" && "border-good", checked && "border-moment")}
      >
        <ClipThumb clip={clip} />
      </Link>
      <label className="absolute top-2 left-2">
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Select ${clip.title}`} className="accent-moment" />
      </label>
      <div className="flex items-center gap-1.5">
        <span className={cn("font-mono text-[15px] font-semibold", top && "text-moment")}>{clip.score}</span>
        <span className="flex-1" />
        <button type="button" onClick={() => onDecide("removed")} title="Remove" aria-label={`Remove ${clip.title}`} className={cn(iconBtn, "size-[30px]", clip.status === "removed" && "text-bad")}>
          <X className="size-4" />
        </button>
        <button type="button" onClick={() => onDecide("kept")} title="Keep" aria-label={`Keep ${clip.title}`} className={cn(iconBtn, "size-[30px]", clip.status === "kept" && "text-good")}>
          <Check className="size-4" />
        </button>
        {!clip.videoUrl && (
          <Link href={`/clips/${clip.id}/edit`} title="Edit" aria-label={`Edit ${clip.title}`} className={cn(iconBtn, "size-[30px]")}>
            <Pencil className="size-4" />
          </Link>
        )}
      </div>
      <strong className="text-xs leading-snug font-medium">{clip.title}</strong>
    </article>
  );
}
