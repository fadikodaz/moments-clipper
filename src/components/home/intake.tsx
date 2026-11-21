"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileVideo, Link2, LoaderCircle, Sparkles, Upload } from "lucide-react";
import { btn, btnCta, btnGhost, btnLg, btnPrimary, btnSm, field, formatTime } from "@/components/kit";
import { Select } from "@/components/ui/controls";
import type { Campaign } from "@/lib/jobs";
import { cn } from "@/lib/utils";

type LinkInfo = { url: string; title: string; channel: string; durationSec: number; thumbnail: string | null };
type Picked = { kind: "link"; info: LinkInfo } | { kind: "file"; file: File };
type Options = { length: string; count: string; captions: string; layout: string; language: string; campaignId: string; from: string; to: string };

const PART_MAX = 4 * 3600;

/** "1:30:00", "90:00" or "90" (minutes) to seconds; empty is null; anything else NaN. */
function parseClock(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) * 60;
  if (!/^\d+(:\d{1,2}){1,2}$/.test(s)) return NaN;
  return s.split(":").reduce((t, x) => t * 60 + Number(x), 0);
}

const VIDEO = /\.(mp4|mov|mkv|webm)$/i;

function size(bytes: number) {
  return bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** One bar for a link or a file. After that: campaign, language and which part; the look is chosen on the next screen. */
export function Intake() {
  const router = useRouter();
  const urlId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const [url, setUrl] = useState("");
  const [over, setOver] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [opts, setOpts] = useState<Options>({ length: "auto", count: "0", captions: "bold", layout: "auto", language: "hi", campaignId: "", from: "", to: "" });
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    fetch("/api/campaigns", { cache: "no-store" })
      .then((r) => r.json())
      .then((list: Campaign[]) => {
        setCampaigns(list);
        // The newest campaign is the one you are most likely clipping for.
        if (list[0]) setOpts((o) => ({ ...o, campaignId: list[0].id, language: list[0].language }));
      })
      .catch(() => {});
  }, []);
  const [upload, setUpload] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);

  async function check() {
    const v = url.trim();
    if (!v) return setError("Paste a YouTube link first, or upload a file.");
    setChecking(true);
    setError(null);
    try {
      const r = await fetch(`/api/link?url=${encodeURIComponent(v)}`);
      const body = await r.json();
      if (!r.ok) setError(body.error ?? "Couldn't read this link.");
      else {
        const info = body as LinkInfo;
        setPicked({ kind: "link", info });
        // Long streams are made in parts of up to 4 hours; start with the first part.
        setOpts((o) => ({ ...o, from: info.durationSec > PART_MAX ? "0:00:00" : "", to: info.durationSec > PART_MAX ? formatTime(PART_MAX) : "" }));
      }
    } catch {
      setError("Couldn't reach the app. Is it still running?");
    }
    setChecking(false);
  }

  function takeFiles(list: FileList | null) {
    const file = Array.from(list ?? []).find((f) => VIDEO.test(f.name));
    if (!file) return setError("Upload an MP4, MOV, MKV or WEBM file.");
    setError(null);
    setPicked({ kind: "file", file });
  }

  function reset() {
    xhr.current?.abort();
    setPicked(null);
    setUpload(null);
    setStarting(false);
    setUrl("");
  }

  const from = parseClock(opts.from);
  const to = parseClock(opts.to);
  const total = picked?.kind === "link" ? picked.info.durationSec : null;
  const partError =
    Number.isNaN(from) || Number.isNaN(to)
      ? "Write times like 1:30:00 (hours:minutes:seconds)."
      : from === null && to === null
        ? total && total > PART_MAX
          ? "This video is longer than 4 hours. Choose a part of up to 4 hours."
          : null
        : (to ?? total ?? 0) - (from ?? 0) < 60
          ? "The part must be at least 1 minute long."
          : (to ?? total ?? Infinity) - (from ?? 0) > PART_MAX
            ? "A part can be at most 4 hours long. Make the rest in another project."
            : null;

  async function start() {
    if (!picked) return;
    if (partError) return setError(partError);
    setError(null);
    setStarting(true);
    const send = { ...opts, from: from === null && to === null ? "" : String(from ?? 0), to: from === null && to === null ? "" : String(to ?? total ?? (from ?? 0) + PART_MAX) };
    if (picked.kind === "link") {
      try {
        const { info } = picked;
        const r = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: info.url, title: info.title, thumbnail: info.thumbnail, durationSec: info.durationSec, ...send, count: Number(opts.count) }),
        });
        const body = await r.json();
        if (r.status === 201 && body.id) return router.push(`/p/${body.id}`);
        setError(body.error ?? "Couldn't start.");
      } catch {
        setError("Couldn't reach the app. Is it still running?");
      }
      setStarting(false);
      return;
    }
    // Files go as the raw request body; XMLHttpRequest because fetch can't report upload progress.
    const { file } = picked;
    const q = new URLSearchParams({ name: file.name, ...send });
    const req = new XMLHttpRequest();
    xhr.current = req;
    req.open("POST", `/api/jobs?${q}`);
    req.setRequestHeader("Content-Type", "application/octet-stream");
    req.upload.onprogress = (e) => e.lengthComputable && setUpload(e.loaded / e.total);
    req.onload = () => {
      const body = JSON.parse(req.responseText || "{}");
      if (req.status === 201 && body.id) return router.push(`/p/${body.id}`);
      setUpload(null);
      setStarting(false);
      setError(body.error ?? `Upload failed (${req.status}).`);
    };
    req.onerror = () => {
      setUpload(null);
      setStarting(false);
      setError("Upload failed. Is the app still running?");
    };
    setUpload(0);
    req.send(file);
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!checking && !picked) check();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!starting) takeFiles(e.dataTransfer.files);
      }}
      className={cn("mx-auto mt-[30px] max-w-[780px] rounded-[22px] border border-border-strong bg-panel p-2.5 transition-shadow", over && "border-moment shadow-[0_0_0_4px_var(--moment-soft)]")}
    >
      {!picked && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-[14px] bg-raised p-2.5 sm:h-[60px] sm:flex-nowrap sm:py-0 sm:pr-2 sm:pl-4">
          <Link2 className="hidden size-[18px] shrink-0 text-subtle sm:block" aria-hidden="true" />
          <label htmlFor={urlId} className="sr-only">
            YouTube link
          </label>
          <input
            id={urlId}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a YouTube link"
            autoComplete="off"
            className="h-10 min-w-0 basis-full bg-transparent text-base outline-none placeholder:text-subtle sm:h-auto sm:flex-1 sm:basis-auto"
          />
          <span className="hidden text-[13px] text-subtle sm:inline">or</span>
          <button type="button" onClick={() => fileRef.current?.click()} className={cn(btn, btnSm, btnGhost, "max-sm:flex-1")}>
            <Upload aria-hidden="true" /> Upload file
          </button>
          <input ref={fileRef} type="file" accept="video/*,.mkv" hidden onChange={(e) => takeFiles(e.target.files)} />
          <button type="submit" disabled={checking} className={cn(btn, btnPrimary, "max-sm:flex-1")}>
            {checking && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {checking ? "Checking link" : "Get clips"}
          </button>
        </div>
      )}

      {picked && (
        <>
          <div className="flex items-center gap-3.5 px-2 pt-3.5 pb-1">
            {picked.kind === "link" ? (
              <span className="relative block aspect-video w-[104px] shrink-0 overflow-hidden rounded-[10px] bg-raised sm:w-[132px]">
                {/* eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnail, shown as-is */}
                {picked.info.thumbnail && <img src={picked.info.thumbnail} alt="" className="h-full w-full object-cover" />}
              </span>
            ) : (
              <span className="grid aspect-video w-[104px] shrink-0 place-items-center rounded-[10px] bg-raised text-subtle sm:w-[132px]">
                <FileVideo className="size-6" strokeWidth={1.75} aria-hidden="true" />
              </span>
            )}
            <span className="min-w-0">
              <b className="line-clamp-2 text-[15px] font-semibold">{picked.kind === "link" ? picked.info.title : picked.file.name}</b>
              <small className="text-[13px] text-muted-foreground">
                {picked.kind === "link"
                  ? `${picked.info.channel ? `${picked.info.channel} on YouTube` : "YouTube"}, ${formatTime(picked.info.durationSec)}`
                  : `Uploaded file, ${size(picked.file.size)}`}
              </small>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 px-2 pt-4 pb-2 md:grid-cols-4">
            <Select
              label="Campaign"
              value={opts.campaignId || "none"}
              disabled={starting}
              onChange={(v) => {
                const id = v === "none" ? "" : v;
                const c = campaigns.find((x) => x.id === id);
                setOpts((o) => ({ ...o, campaignId: id, language: c?.language ?? o.language }));
              }}
              options={[["none", "No campaign"], ...campaigns.map((c) => [c.id, c.name] as const)]}
            />
            <Select
              label="Language spoken"
              value={opts.language}
              disabled={starting || !!opts.campaignId}
              onChange={(v) => setOpts((o) => ({ ...o, language: v }))}
              options={[["en", "English"], ["hi", "Hindi / Hinglish"]]}
            />
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">From (optional)</span>
              <input value={opts.from} disabled={starting} onChange={(e) => setOpts((o) => ({ ...o, from: e.target.value }))} placeholder="0:00:00" inputMode="numeric" className={field} />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">To (optional)</span>
              <input value={opts.to} disabled={starting} onChange={(e) => setOpts((o) => ({ ...o, to: e.target.value }))} placeholder={total ? formatTime(Math.min(total, PART_MAX)) : "end"} inputMode="numeric" className={field} />
            </label>
            <p className={cn("col-span-2 self-end pb-2 text-xs md:col-span-2", partError ? "text-bad" : "text-subtle")}>
              {partError ??
                (total && total > PART_MAX
                  ? `This stream is ${formatTime(total)} long. Make it in parts of up to 4 hours: next time start From where this part ends.`
                  : "Leave empty to use the whole video.")}
            </p>
          </div>

          {upload !== null ? (
            <div className="px-2 pt-2 pb-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{upload < 1 ? "Uploading" : "Starting"}</span>
                <span className="font-mono">{Math.round(upload * 100)}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label="Upload progress" aria-valuenow={Math.round(upload * 100)} aria-valuemin={0} aria-valuemax={100}>
                <i className="block h-full rounded-full bg-foreground transition-[width]" style={{ width: `${upload * 100}%` }} />
              </div>
              <button type="button" onClick={reset} className="mt-2 text-xs text-muted-foreground underline underline-offset-[3px] hover:text-foreground">
                Cancel upload
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3.5 px-2 py-1.5">
              <p className="max-w-[48ch] text-xs text-subtle">
                Only clip videos you own or have permission to use.
                {picked.kind === "link" && " We fetch the audio first and only the seconds we turn into shorts."}
              </p>
              <span className="flex gap-2 max-sm:w-full">
                <button type="button" onClick={reset} disabled={starting} className={cn(btn, btnGhost, "max-sm:flex-1")}>
                  Cancel
                </button>
                <button type="button" onClick={start} disabled={starting} className={cn(btn, btnCta, btnLg, "max-sm:flex-1")}>
                  {starting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                  {starting ? (upload !== null ? "Uploading" : "Opening") : "Next: set up"}
                </button>
              </span>
            </div>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="mx-2 mt-2 mb-1 text-[13px] text-bad">
          {error}
        </p>
      )}
    </form>
  );
}
