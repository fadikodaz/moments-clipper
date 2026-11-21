"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileVideo, Link2, LoaderCircle, Sparkles, X } from "lucide-react";
import { btn, btnCta, btnGhost, btnLg, btnSm, formatTime } from "@/components/kit";
import { RangeSlider, Select, fieldLabel } from "@/components/ui/controls";
import type { Campaign } from "@/lib/jobs";
import { cn } from "@/lib/utils";

type LinkInfo = { url: string; title: string; channel: string; durationSec: number; thumbnail: string | null };
type Picked = { kind: "link"; info: LinkInfo } | { kind: "file"; file: File; durationSec: number | null };

const PART_MAX = 4 * 3600;
const VIDEO = /\.(mp4|mov|mkv|webm)$/i;
const LINK = /(youtube\.com\/(watch|live|shorts)|youtu\.be\/)/i;

/** "1 hour", "1 h 30 min", "45 min" */
function span(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} hour${h > 1 ? "s" : ""}`;
}

/** Rough time to make the shorts on a slow connection: reading the part, then cutting. */
function estimate(sec: number) {
  return Math.max(5, Math.round(5 + (sec / 3600) * 7));
}

/** Length of a local video file, read by the browser (no upload needed). */
function fileDuration(file: File): Promise<number | null> {
  return new Promise((res) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      res(Number.isFinite(v.duration) ? v.duration : null);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      res(null);
    };
    v.src = url;
  });
}

/** Paste a link (or drop a recording): the video shows at once, then which part and which campaign. The look comes next. */
export function Intake() {
  const router = useRouter();
  const urlId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const lastChecked = useRef("");
  const [url, setUrl] = useState("");
  const [over, setOver] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [part, setPart] = useState<[number, number] | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [language, setLanguage] = useState("hi");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [upload, setUpload] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    fetch("/api/campaigns", { cache: "no-store" })
      .then((r) => r.json())
      .then((list: Campaign[]) => {
        setCampaigns(list);
        // The newest campaign is the one you are most likely clipping for.
        if (list[0]) {
          setCampaignId(list[0].id);
          setLanguage(list[0].language);
        }
      })
      .catch(() => {});
  }, []);

  function choose(total: number | null) {
    // Long streams are made in parts of up to 4 hours; start with the first part.
    setPart(total ? [0, Math.min(total, PART_MAX)] : null);
  }

  async function check(value = url) {
    const v = value.trim();
    if (!v) return setError("Paste a YouTube link, or upload a recording.");
    if (v === lastChecked.current && picked) return;
    lastChecked.current = v;
    setChecking(true);
    setError(null);
    try {
      const r = await fetch(`/api/link?url=${encodeURIComponent(v)}`);
      const body = await r.json();
      if (!r.ok) setError(body.error ?? "Couldn't read this link.");
      else {
        const info = body as LinkInfo;
        setPicked({ kind: "link", info });
        choose(info.durationSec);
      }
    } catch {
      setError("Couldn't reach the app. Is it still running?");
    }
    setChecking(false);
  }

  // A pasted YouTube link is read at once; typing waits a moment.
  useEffect(() => {
    if (!LINK.test(url) || picked || checking) return;
    const t = window.setTimeout(() => check(url), 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when the text changes only
  }, [url]);

  async function takeFiles(list: FileList | null) {
    const file = Array.from(list ?? []).find((f) => VIDEO.test(f.name));
    if (!file) return setError("Upload an MP4, MOV, MKV or WEBM file.");
    setError(null);
    const durationSec = await fileDuration(file);
    setPicked({ kind: "file", file, durationSec });
    choose(durationSec);
  }

  function reset() {
    xhr.current?.abort();
    lastChecked.current = "";
    setPicked(null);
    setPart(null);
    setUpload(null);
    setStarting(false);
    setError(null);
    setUrl("");
  }

  const total = picked ? (picked.kind === "link" ? picked.info.durationSec : picked.durationSec) : null;
  const whole = !part || !total || (part[0] === 0 && part[1] >= total - 1);
  const partSec = part ? part[1] - part[0] : (total ?? 3600);

  function movePart([a, b]: [number, number]) {
    // Keep a part between 1 minute and 4 hours, moving the other end along.
    if (b - a > PART_MAX) {
      if (part && a !== part[0]) b = a + PART_MAX;
      else a = b - PART_MAX;
    }
    setPart([a, b]);
  }

  async function start() {
    if (!picked) return;
    if (partSec < 60) return setError("Choose a part of at least 1 minute.");
    setError(null);
    setStarting(true);
    const send = {
      length: "auto",
      count: "0",
      captions: "bold",
      layout: "auto",
      language,
      campaignId,
      from: whole || !part ? "" : String(Math.round(part[0])),
      to: whole || !part ? "" : String(Math.round(part[1])),
    };
    if (picked.kind === "link") {
      try {
        const { info } = picked;
        const r = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: info.url, title: info.title, thumbnail: info.thumbnail, durationSec: info.durationSec, ...send, count: 0 }),
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

  const showLink = !picked || picked.kind === "link";

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
      className="mx-auto mt-7 max-w-[760px]"
    >
      {showLink ? (
        <div
          className={cn(
            "flex h-16 items-center gap-3 rounded-2xl border border-border-strong bg-panel pr-2.5 pl-5 transition-[border-color,box-shadow] focus-within:border-moment focus-within:shadow-[0_0_0_4px_var(--moment-soft)]",
            over && "border-moment shadow-[0_0_0_4px_var(--moment-soft)]",
          )}
        >
          {checking ? <LoaderCircle className="size-5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" /> : <Link2 className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <label htmlFor={urlId} className="sr-only">
            YouTube link
          </label>
          <input
            id={urlId}
            value={picked?.kind === "link" ? picked.info.url : url}
            readOnly={!!picked}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a YouTube link, even a 12-hour stream"
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-[17px] font-medium outline-none placeholder:font-normal placeholder:text-subtle"
          />
          {picked && !starting && (
            <button type="button" onClick={reset} className={cn(btn, btnSm, btnGhost)}>
              Clear
            </button>
          )}
        </div>
      ) : null}

      {!picked && (
        <p className="mt-3 text-sm text-muted-foreground">
          or{" "}
          <button type="button" onClick={() => fileRef.current?.click()} className="cursor-pointer font-semibold text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
            upload a recording
          </button>
          <input ref={fileRef} type="file" accept="video/*,.mkv" hidden onChange={(e) => takeFiles(e.target.files)} />
        </p>
      )}

      {picked && (
        <div className="mt-3.5 animate-rise overflow-hidden rounded-2xl border bg-panel">
          <div className="grid items-center gap-[18px] p-4 sm:grid-cols-[200px_minmax(0,1fr)_auto]">
            {picked.kind === "link" ? (
              <span className="relative block aspect-video w-full overflow-hidden rounded-[10px] bg-raised">
                {/* eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnail, shown as-is */}
                {picked.info.thumbnail && <img src={picked.info.thumbnail} alt="" className="h-full w-full object-cover" />}
              </span>
            ) : (
              <span className="grid aspect-video w-full place-items-center rounded-[10px] bg-raised text-subtle">
                <FileVideo className="size-7" strokeWidth={1.75} aria-hidden="true" />
              </span>
            )}
            <span className="min-w-0">
              <b className="line-clamp-2 text-lg leading-snug font-semibold">{picked.kind === "link" ? picked.info.title : picked.file.name}</b>
              <small className="mt-1 block text-sm text-muted-foreground">
                {picked.kind === "link" ? [picked.info.channel || "YouTube", total ? span(total) : null].filter(Boolean).join(", ") : ["Recording on this computer", total ? span(total) : null].filter(Boolean).join(", ")}
              </small>
            </span>
            {picked.kind === "file" && !starting && (
              <button type="button" onClick={reset} aria-label="Remove this file" className={cn(btn, btnSm, btnGhost, "w-[34px] px-0 sm:self-start")}>
                <X aria-hidden="true" />
              </button>
            )}
          </div>

          <div className={cn("grid gap-[18px] border-t p-4", campaigns.length || language ? "sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" : "")}>
            {part && total ? (
              <div className="grid gap-2">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={fieldLabel}>Part to clip</span>
                  <span className="text-[13px] font-medium">{whole ? `The whole video, ${span(total)}` : `${formatTime(part[0])} to ${formatTime(part[1])}, ${span(part[1] - part[0])}`}</span>
                </span>
                <div className="pt-1">
                  <RangeSlider value={part} min={0} max={Math.ceil(total)} step={60} labels={["Part starts at", "Part ends at"]} onChange={movePart} />
                </div>
                <span className="flex justify-between text-xs text-subtle">
                  <span>0:00</span>
                  <span>{formatTime(total)}</span>
                </span>
                {total > PART_MAX && <span className="text-xs text-subtle">Up to 4 hours at a time. Make the next part afterwards.</span>}
              </div>
            ) : (
              <span className="self-center text-sm text-muted-foreground">The whole recording is used.</span>
            )}
            <div className="grid content-start gap-3.5">
              <Select
                label="Campaign"
                value={campaignId || "none"}
                disabled={starting}
                onChange={(v) => {
                  const id = v === "none" ? "" : v;
                  setCampaignId(id);
                  const c = campaigns.find((x) => x.id === id);
                  if (c) setLanguage(c.language);
                }}
                options={[["none", "No campaign"], ...campaigns.map((c) => [c.id, c.name] as const)]}
              />
              {!campaignId && <Select label="Language spoken" value={language} disabled={starting} onChange={setLanguage} options={[["en", "English"], ["hi", "Hindi / Hinglish"]]} />}
            </div>
          </div>

          {upload !== null ? (
            <div className="border-t p-4">
              <div className="flex justify-between text-[13px] text-muted-foreground">
                <span>{upload < 1 ? "Uploading the recording" : "Starting"}</span>
                <span>{Math.round(upload * 100)}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label="Upload progress" aria-valuenow={Math.round(upload * 100)} aria-valuemin={0} aria-valuemax={100}>
                <i className="block h-full rounded-full bg-foreground transition-[width]" style={{ width: `${upload * 100}%` }} />
              </div>
              <button type="button" onClick={reset} className="mt-2.5 cursor-pointer text-[13px] text-muted-foreground underline underline-offset-[3px] hover:text-foreground">
                Cancel upload
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3.5 border-t bg-white/[0.015] p-4">
              <p className="text-sm text-muted-foreground">
                About <b className="font-semibold text-foreground">{estimate(partSec)} minutes</b>. You pick the look while it reads the video.
              </p>
              <button type="button" onClick={start} disabled={starting} className={cn(btn, btnCta, btnLg, "max-sm:w-full")}>
                {starting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                {starting ? (upload !== null ? "Uploading" : "Opening") : "Find the best moments"}
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      )}
    </form>
  );
}
