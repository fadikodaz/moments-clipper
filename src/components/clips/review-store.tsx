"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { clips as source, type Clip } from "@/lib/mock-data";
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

export function ReviewProvider({ children, initial }: { children: ReactNode; initial?: Clip[] }) {
  const fresh = (c: Clip): ReviewClip => ({ ...c, status: "new", layout: "follow", caption: "bold" });
  const [clips, setClips] = useState<ReviewClip[]>(() => (initial ?? source).map(fresh));
  const [seen, setSeen] = useState(initial);

  // New shorts arrive while a job is still running: add them, keep the choices already made.
  if (initial && initial !== seen) {
    setSeen(initial);
    setClips((cs) => {
      const known = new Set(cs.map((c) => c.id));
      return [...cs, ...initial.filter((c) => !known.has(c.id)).map(fresh)];
    });
  }

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
