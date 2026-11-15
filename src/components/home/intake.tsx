"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileVideo, HardDrive, Link2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCEPTED_HOSTS = ["twitch.tv", "kick.com", "youtube.com", "youtu.be"];

type Notice = { tone: "ok" | "error"; text: string } | null;

function checkLink(raw: string): Notice {
  const value = raw.trim();
  if (!value) return { tone: "error", text: "Paste a Twitch, Kick or YouTube link first." };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { tone: "error", text: "That doesn't look like a link." };
  }
  const host = url.hostname.replace(/^www\./, "");
  if (!ACCEPTED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { tone: "error", text: "We support Twitch, Kick and YouTube links for now." };
  }
  return { tone: "ok", text: `Link looks good (${host}). Pasting links comes in a later step; for now, drop the video file above.` };
}

export function Intake() {
  const fileRef = useRef<HTMLInputElement>(null);
  const linkId = useId();
  const [over, setOver] = useState(false);
  const [link, setLink] = useState("");
  const [notice, setNotice] = useState<Notice>(null);

  const [picked, setPicked] = useState<File | null>(null);

  function takeFiles(list: FileList | null) {
    const files = Array.from(list ?? []).filter((f) => /\.(mp4|mov|mkv|webm)$/i.test(f.name));
    if (!files.length) {
      setNotice({ tone: "error", text: "Drop an MP4, MOV, MKV or WEBM file." });
      return;
    }
    setNotice(files.length > 1 ? { tone: "ok", text: "Joining several files comes later, so only the first one is used for now." } : null);
    setPicked(files[0]);
  }

  return (
    <form
      className="grid gap-1 rounded-xl border bg-panel p-2"
      onSubmit={(e) => {
        e.preventDefault();
        setNotice(checkLink(link));
      }}
    >
      {picked ? (
        <UploadPanel file={picked} onCancel={() => setPicked(null)} />
      ) : (
      <label
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          takeFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer items-center gap-3.5 rounded-lg border border-dashed border-border-strong p-3.5 transition-colors sm:p-[18px]",
          "hover:border-moment hover:bg-moment-soft",
          over && "border-moment bg-moment-soft",
        )}
      >
        <input ref={fileRef} type="file" accept="video/*,.mkv" multiple hidden onChange={(e) => takeFiles(e.target.files)} />
        <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border bg-raised">
          <Upload className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <span>
          <b className="block text-sm font-semibold">Drop a recording</b>
          <small className="text-xs text-subtle">MP4, MOV, MKV or WEBM up to 20 GB.</small>
        </span>
      </label>
      )}

      <div className="flex items-center gap-2.5 px-3 py-1.5 text-[11px] text-subtle before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
        or paste a link
      </div>

      <div className="flex h-[46px] items-center gap-2.5 rounded-lg bg-raised pr-1.5 pl-2.5 text-subtle sm:pl-3.5">
        <Link2 className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <label htmlFor={linkId} className="sr-only">
          Video link
        </label>
        <input
          id={linkId}
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="twitch.tv/videos/…  or  kick.com/…"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle"
        />
        <Button type="submit" size="lg" className="h-[34px] px-4 text-[13px] font-semibold">
          Get clips
        </Button>
      </div>

      {notice && (
        <p role="status" className={cn("px-2.5 pt-1.5 text-xs", notice.tone === "ok" ? "text-good" : "text-bad")}>
          {notice.text}
        </p>
      )}

      <div className="flex flex-wrap justify-between gap-2.5 px-2.5 pt-2 pb-1">
        <button
          type="button"
          onClick={() => setNotice({ tone: "ok", text: "The example GTA VI session opens once the clips page is built." })}
          className="text-xs text-foreground underline decoration-border-strong underline-offset-[3px] hover:decoration-current"
        >
          No video handy? Try an example GTA VI session
        </button>
        <span className="inline-flex items-center gap-1.5 text-xs text-subtle" aria-disabled="true" title="Coming soon">
          <HardDrive className="size-4" strokeWidth={1.75} aria-hidden="true" />
          Google Drive import, soon
        </span>
      </div>
    </form>
  );
}

const FACECAM = [
  { id: "top-right", name: "Facecam top right" },
  { id: "top-left", name: "Facecam top left" },
  { id: "bottom-right", name: "Facecam bottom right" },
  { id: "bottom-left", name: "Facecam bottom left" },
  { id: "none", name: "No facecam" },
];

function size(bytes: number) {
  return bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** Sends the file as the raw request body; XMLHttpRequest because fetch can't report upload progress. */
function UploadPanel({ file, onCancel }: { file: File; onCancel: () => void }) {
  const router = useRouter();
  const layoutId = useId();
  const [layout, setLayout] = useState("top-right");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);

  function start() {
    setError(null);
    setProgress(0);
    const req = new XMLHttpRequest();
    xhr.current = req;
    req.open("POST", `/api/jobs?name=${encodeURIComponent(file.name)}&layout=${layout}`);
    req.setRequestHeader("Content-Type", "application/octet-stream");
    req.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total);
    req.onload = () => {
      const body = JSON.parse(req.responseText || "{}");
      if (req.status === 201 && body.id) router.push(`/p/${body.id}`);
      else {
        setProgress(null);
        setError(body.error ?? `Upload failed (${req.status}).`);
      }
    };
    req.onerror = () => {
      setProgress(null);
      setError("Upload failed. Is the app still running?");
    };
    req.send(file);
  }

  function cancel() {
    xhr.current?.abort();
    onCancel();
  }

  const busy = progress !== null;
  return (
    <div className="grid gap-3 rounded-lg border border-border-strong p-3.5 sm:p-[18px]">
      <div className="flex items-center gap-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border bg-raised">
          <FileVideo className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <b className="block truncate text-sm font-semibold">{file.name}</b>
          <small className="text-xs text-subtle">{size(file.size)}</small>
        </span>
      </div>

      {busy ? (
        <div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{progress < 1 ? "Uploading" : "Starting the engine"}</span>
            <span className="font-mono">{Math.round(progress * 100)}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label="Upload progress" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <i className="block h-full rounded-full bg-foreground transition-[width]" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={layoutId} className="sr-only">
            Where is your facecam?
          </label>
          <select id={layoutId} value={layout} onChange={(e) => setLayout(e.target.value)} className="h-[34px] rounded-md border bg-panel px-2.5 text-xs outline-none hover:border-border-strong">
            {FACECAM.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <span className="flex-1" />
          <Button type="button" variant="ghost" size="lg" onClick={cancel} className="h-[34px] text-[13px] text-muted-foreground">
            Cancel
          </Button>
          <Button type="button" size="lg" onClick={start} className="h-[34px] px-4 text-[13px] font-semibold">
            Get clips
          </Button>
        </div>
      )}
      {busy && (
        <button type="button" onClick={cancel} className="justify-self-start text-xs text-muted-foreground underline underline-offset-[3px]">
          Cancel upload
        </button>
      )}
      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
    </div>
  );
}