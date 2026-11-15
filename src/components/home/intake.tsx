"use client";

import { useId, useRef, useState } from "react";
import { HardDrive, Link2, Upload } from "lucide-react";
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
  return { tone: "ok", text: `Link looks good (${host}). Processing gets connected in the upload step.` };
}

export function Intake() {
  const fileRef = useRef<HTMLInputElement>(null);
  const linkId = useId();
  const [over, setOver] = useState(false);
  const [link, setLink] = useState("");
  const [notice, setNotice] = useState<Notice>(null);

  function takeFiles(list: FileList | null) {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|mkv)$/i.test(f.name));
    if (!files.length) {
      setNotice({ tone: "error", text: "Drop an MP4, MOV or MKV file." });
      return;
    }
    const names = files.map((f) => f.name).join(", ");
    setNotice({ tone: "ok", text: `${files.length === 1 ? "1 file" : `${files.length} files`} ready: ${names}. Uploading gets connected in the upload step.` });
  }

  return (
    <form
      className="grid gap-1 rounded-xl border bg-panel p-2"
      onSubmit={(e) => {
        e.preventDefault();
        setNotice(checkLink(link));
      }}
    >
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
          <small className="text-xs text-subtle">MP4, MOV or MKV up to 20 GB. Several files from one session are joined.</small>
        </span>
      </label>

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
