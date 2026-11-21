"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Check, ExternalLink, KeyRound, LoaderCircle, X } from "lucide-react";
import { btn, btnCta, btnLg, field } from "@/components/styles";
import { Fold, fieldLabel } from "@/components/ui/controls";
import { cn } from "@/lib/utils";

type Status = { groq: boolean; claude: boolean; python: boolean; ffmpeg: boolean };

/** Home shows this one-time card instead of the link box until a free Groq key is saved. */
export function KeyGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    fetch("/api/keys", { cache: "no-store" })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ groq: true, claude: false, python: true, ffmpeg: true })); // never lock people out
  }, []);
  if (!status) return null;
  if (status.groq) return <>{children}</>;
  return <KeyCard status={status} onDone={setStatus} />;
}

function KeyCard({ status, onDone }: { status: Status; onDone: (s: Status) => void }) {
  const [groq, setGroq] = useState("");
  const [claude, setClaude] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    const r = await fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groq, claude }) }).catch(() => null);
    const data = r ? await r.json().catch(() => ({})) : { error: "The app isn't answering. Is it still running?" };
    setBusy(false);
    if (!r?.ok) return setError(data.error ?? "Couldn't save the key.");
    onDone(data);
  }

  return (
    <section className="mx-auto mt-8 max-w-[760px] animate-rise rounded-2xl border bg-panel p-6 md:p-8">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-raised">
          <KeyRound className="size-5" aria-hidden="true" />
        </span>
        <h2 className="font-heading text-[22px] font-bold tracking-[-0.02em]">One free key and you&apos;re ready</h2>
      </div>

      <div className="mt-6 grid gap-1.5">
        <label htmlFor="groq" className={fieldLabel}>
          Groq key
        </label>
        <input id="groq" value={groq} onChange={(e) => setGroq(e.target.value)} placeholder="gsk_…" autoComplete="off" spellCheck={false} className={cn(field, "h-12 text-[15px]")} />
        <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground underline underline-offset-[3px] hover:text-foreground">
          Get a free key at console.groq.com <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </div>

      <Fold title="Claude key (optional, better picks)" className="mt-5">
        <input aria-label="Claude key" value={claude} onChange={(e) => setClaude(e.target.value)} placeholder="sk-ant-…" autoComplete="off" spellCheck={false} className={field} />
      </Fold>

      {(!status.python || !status.ffmpeg) && (
        <ul className="mt-5 grid gap-1.5 text-sm">
          <Tool ok={status.python} name="Python packages" fix="Install Python 3.10+, then run npm i again" />
          <Tool ok={status.ffmpeg} name="ffmpeg" fix="Install ffmpeg, then open a new terminal" />
        </ul>
      )}

      {error && <p className="mt-4 text-sm text-[#ff5c6c]">{error}</p>}

      <button type="button" disabled={!groq.trim() || busy} onClick={save} className={cn(btn, btnLg, btnCta, "mt-6 w-full")}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
        {busy ? "Checking the key" : "Start clipping"}
      </button>
    </section>
  );
}

function Tool({ ok, name, fix }: { ok: boolean; name: string; fix: string }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? <Check className="size-4 text-[#5bd69a]" aria-hidden="true" /> : <X className="size-4 text-[#ff5c6c]" aria-hidden="true" />}
      <span className="font-semibold">{name}</span>
      {!ok && <span className="text-muted-foreground">{fix}</span>}
    </li>
  );
}
