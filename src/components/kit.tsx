"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Buttons, shared by every screen (same sizes as the approved mockups). */
export const btn =
  "inline-flex items-center justify-center gap-2 h-10 px-4 rounded-[10px] border border-border-strong bg-raised text-sm font-semibold whitespace-nowrap transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-[18px] [&_svg]:shrink-0";
export const btnPrimary = "border-foreground bg-foreground text-background hover:bg-[#e4e4e7]";
export const btnCta = "border-moment bg-moment text-moment-ink hover:bg-moment hover:brightness-[1.07]";
export const btnGhost = "border-transparent bg-transparent text-muted-foreground hover:bg-raised hover:text-foreground";
export const btnSm = "h-[34px] px-3 text-[13px] rounded-[9px] [&_svg]:size-4";
export const btnLg = "h-12 px-[22px] text-[15px] rounded-xl";
export const btnIcon = "w-[34px] px-0";
export const field = "h-[38px] w-full rounded-[10px] border bg-panel px-3 outline-none hover:border-border-strong focus:border-border-strong";

export function formatTime(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

export function ago(ms: number) {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Scores are relative to this video: its best shorts get the moment colour. */
export function scoreLabel(score: number, best: number) {
  if (score >= best - 2) return { label: "Best", top: true };
  if (score >= 75) return { label: "Great", top: false };
  if (score >= 70) return { label: "Good", top: false };
  return { label: "Okay", top: false };
}

export function Score({ score, best, className }: { score: number; best: number; className?: string }) {
  const { label, top } = scoreLabel(score, best);
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-[5px] rounded-full px-[9px] py-0.5 text-xs font-medium whitespace-nowrap",
        top ? "bg-moment text-moment-ink" : "bg-background/80 text-muted-foreground backdrop-blur-sm",
        className,
      )}
    >
      <b className={cn("font-mono text-[13px] font-semibold", !top && "text-foreground")}>{score}</b>
      {label}
    </span>
  );
}

/** A small popover menu that closes on outside click or Escape. */
export function Menu({ open, onClose, children, className }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !ref.current?.parentElement?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} role="menu" className={cn("absolute right-0 z-20 min-w-[190px] rounded-xl border border-border-strong bg-raised p-1 shadow-[0_18px_50px_rgb(0_0_0/0.55)]", className)}>
      {children}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn("flex w-full items-center gap-[9px] rounded-lg px-2.5 py-[9px] text-left text-sm hover:bg-hover [&_svg]:size-4 [&_svg]:shrink-0", danger && "text-bad")}
    >
      {icon}
      {children}
    </button>
  );
}

export function useToast() {
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

export function Toast({ msg, raised }: { msg: string | null; raised?: boolean }) {
  return (
    <div aria-live="polite" className={cn("pointer-events-none fixed left-1/2 z-[60] -translate-x-1/2 md:ml-[110px]", raised ? "bottom-[150px] md:bottom-[96px]" : "bottom-[76px] md:bottom-6")}>
      {msg && <p className="rounded-xl bg-foreground px-4 py-2.5 text-[13px] font-medium whitespace-nowrap text-background shadow-[0_12px_40px_rgb(0_0_0/0.5)]">{msg}</p>}
    </div>
  );
}

/** JSON request helper: returns the parsed body, or throws an Error with the server's message. */
export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const r = await fetch(url, { ...rest, ...(json !== undefined ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json" } } : {}) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? "Something went wrong. Is the app still running?");
  return body as T;
}
