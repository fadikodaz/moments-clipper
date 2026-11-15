"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { clips as source } from "@/lib/mock-data";
import type { ClipPatch, ReviewClip } from "./types";

/**
 * Review choices for the current project, kept for the whole browser session so they survive
 * moving between Home, Clips and the editor. This is replaced by Supabase in the data step.
 */
type ReviewStore = {
  clips: ReviewClip[];
  patch: (id: string, p: ClipPatch) => void;
  patchMany: (ids: Iterable<string>, p: ClipPatch) => void;
};

const Ctx = createContext<ReviewStore | null>(null);

export function ReviewProvider({ children }: { children: ReactNode }) {
  const [clips, setClips] = useState<ReviewClip[]>(() => source.map((c) => ({ ...c, status: "new", layout: "follow", caption: "bold" })));

  const patch = useCallback((id: string, p: ClipPatch) => setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c))), []);
  const patchMany = useCallback((ids: Iterable<string>, p: ClipPatch) => {
    const set = new Set(ids);
    setClips((cs) => cs.map((c) => (set.has(c.id) ? { ...c, ...p } : c)));
  }, []);

  const value = useMemo(() => ({ clips, patch, patchMany }), [clips, patch, patchMany]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReview() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useReview must be used inside ReviewProvider");
  return v;
}
