"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileVideo, Link2, LoaderCircle, Sparkles, Upload } from "lucide-react";
import { btn, btnCta, btnGhost, btnLg, btnPrimary, btnSm, field, formatTime } from "@/components/kit";
import { cn } from "@/lib/utils";

type LinkInfo = { url: string; title: string; channel: string; durationSec: number; thumbnail: string | null };
type Picked = { kind: "link"; info: LinkInfo } | { kind: "file"; file: File };
type Options = { length: string; count: string; captions: string; layout: string };

const VIDEO = /\.(mp4|mov|mkv|webm)$/i;

function size(bytes: number) {
  return bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** One bar for a link or a file. After that: what we found, four simple choices, and Get clips. */
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
  const [opts, setOpts] = useState<Options>({ length: "auto", count: "0", captions: "bold", layout: "auto" });
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
      else setPicked({ kind: "link", info: body as LinkInfo });
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

  async function start() {
    if (!picked) return;
    setError(null);
    setStarting(true);
    if (picked.kind === "link") {
      try {
        const { info } = picked;
        const r = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: info.url, title: info.title, thumbnail: info.thumbnail, durationSec: info.durationSec, ...opts, count: Number(opts.count) }),
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
    const q = new URLSearchParams({ name: file.name, ...opts });
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

  const select = (key: keyof Options, label: string, choices: [string, string][]) => (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select value={opts[key]} disabled={starting} onChange={(e) => setOpts((o) => ({ ...o, [key]: e.target.value }))} className={field}>
        {choices.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );

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
            {select("length", "Clip length", [
              ["auto", "Auto (60 s to 2 min)"],
              ["short", "Short (30 to 60 s)"],
              ["long", "Long (1 to 3 min)"],
            ])}
            {select("count", "How many clips", [
              ["0", "Auto (about 1 per 5 min)"],
              ["5", "5"],
              ["10", "10"],
              ["20", "20"],
            ])}
            {select("captions", "Captions", [
              ["bold", "Bold, word by word"],
              ["simple", "Simple"],
              ["none", "No captions"],
            ])}
            {select("layout", "Facecam", [
              ["auto", "Find it for me"],
              ["none", "No facecam"],
            ])}
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
                  {starting ? "Starting" : "Get clips"}
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
