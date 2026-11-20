"use client";

import { useEffect, useState } from "react";
import { ExternalLink, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { Toast, api, btn, btnCta, btnGhost, btnPrimary, btnSm, field, useToast } from "@/components/kit";
import type { Campaign } from "@/lib/jobs";
import { cn } from "@/lib/utils";

type Draft = Omit<Campaign, "id" | "created" | "hashtags" | "extraTags" | "keywords"> & { hashtags: string; extraTags: string; keywords: string };

const EMPTY: Draft = { name: "", streamer: "", mention: "", hashtags: "", extraTags: "", keywords: "", language: "en", lookFor: "", avoid: "", link: "", notes: "" };

const toDraft = (c: Campaign): Draft => ({ ...c, hashtags: c.hashtags.join(" "), extraTags: c.extraTags.join(" "), keywords: (c.keywords ?? []).join(", ") });

/** Saved clipping campaigns: their rules shape which moments are picked and what every caption says. */
export function CampaignsView() {
  const [list, setList] = useState<Campaign[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api<Campaign[]>("/api/campaigns", { cache: "no-store" })
      .then(setList)
      .catch(() => setList([]));
  }, []);

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const saved = await api<Campaign>(editing.id ? `/api/campaigns/${editing.id}` : "/api/campaigns", { method: editing.id ? "PUT" : "POST", json: editing.draft });
      setList((l) => [saved, ...(l ?? []).filter((c) => c.id !== saved.id)]);
      setEditing(null);
      toast.show("Campaign saved. Pick it on New clips.");
    } catch (e) {
      toast.show((e as Error).message);
    }
    setSaving(false);
  }

  async function remove(c: Campaign) {
    if (!confirm(`Delete the campaign "${c.name}"? Projects already made keep their rules.`)) return;
    try {
      await api(`/api/campaigns/${c.id}`, { method: "DELETE" });
      setList((l) => (l ?? []).filter((x) => x.id !== c.id));
      toast.show("Campaign deleted");
    } catch (e) {
      toast.show((e as Error).message);
    }
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, [k]: v } } : e));
  const label = "grid gap-1.5 text-[13px] font-medium text-muted-foreground";
  const hint = "text-xs font-normal text-subtle";

  return (
    <div className="mx-auto max-w-[900px] px-3.5 pt-[18px] pb-[130px] md:px-8 md:pt-8 md:pb-[120px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] leading-[1.15] font-[650] tracking-[-0.035em]">Campaigns</h1>
          <p className="mt-1 max-w-[60ch] text-muted-foreground">Save the rules of a clipping campaign once. Shorts made for it focus on that streamer, and every caption gets the required name and hashtags.</p>
        </div>
        {!editing && (
          <button type="button" onClick={() => setEditing({ id: null, draft: EMPTY })} className={cn(btn, btnPrimary)}>
            <Plus aria-hidden="true" /> New campaign
          </button>
        )}
      </div>

      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="mb-8 grid gap-4 rounded-2xl border border-border-strong bg-panel p-4 md:p-5"
        >
          <h2 className="text-base font-semibold">{editing.id ? "Edit campaign" : "New campaign"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              Campaign name
              <input required value={editing.draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Kai Cenat GTA 6 Marathon" className={field} />
            </label>
            <label className={label}>
              Campaign page link
              <input value={editing.draft.link} onChange={(e) => set("link", e.target.value)} placeholder="https://contentrewards.com/…" className={field} />
            </label>
            <label className={label}>
              Streamer
              <input value={editing.draft.streamer} onChange={(e) => set("streamer", e.target.value)} placeholder="Kai Cenat" className={field} />
              <span className={hint}>Picked moments must be about this person.</span>
            </label>
            <label className={label}>
              Name every caption must mention
              <input value={editing.draft.mention} onChange={(e) => set("mention", e.target.value)} placeholder="Kai Cenat" className={field} />
              <span className={hint}>Added to the opening line on screen and to every caption.</span>
            </label>
            <label className={label}>
              Required hashtags
              <input value={editing.draft.hashtags} onChange={(e) => set("hashtags", e.target.value)} placeholder="#KAICENAT" className={field} />
            </label>
            <label className={label}>
              Extra hashtags
              <input value={editing.draft.extraTags} onChange={(e) => set("extraTags", e.target.value)} placeholder="#gta6 #kaicenatclips" className={field} />
            </label>
            <label className={label}>
              Search words for titles
              <input value={editing.draft.keywords} onChange={(e) => set("keywords", e.target.value)} placeholder="GTA 6, GTA VI" className={field} />
              <span className={hint}>The AI puts one of these in each title, so people searching find it.</span>
            </label>
            <label className={label}>
              Stream language
              <select value={editing.draft.language} onChange={(e) => set("language", e.target.value as Draft["language"])} className={field}>
                <option value="en">English</option>
                <option value="hi">Hindi / Hinglish</option>
              </select>
            </label>
          </div>
          <label className={label}>
            What to look for
            <textarea rows={2} value={editing.draft.lookFor} onChange={(e) => set("lookFor", e.target.value)} placeholder="Funny moments, memorable quotes, big reactions" className={cn(field, "h-auto py-2")} />
          </label>
          <label className={label}>
            What to avoid
            <textarea rows={2} value={editing.draft.avoid} onChange={(e) => set("avoid", e.target.value)} placeholder="Anything that shows the streamer in a negative light" className={cn(field, "h-auto py-2")} />
          </label>
          <label className={label}>
            Full rules (for your own reference)
            <textarea rows={4} value={editing.draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Paste the campaign's rule sheet here" className={cn(field, "h-auto py-2")} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} disabled={saving} className={cn(btn, btnGhost)}>
              Cancel
            </button>
            <button type="submit" disabled={saving || !editing.draft.name.trim()} className={cn(btn, btnCta)}>
              {saving && <LoaderCircle className="animate-spin" aria-hidden="true" />} Save campaign
            </button>
          </div>
        </form>
      )}

      {list === null ? (
        <LoaderCircle className="mx-auto mt-16 size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      ) : list.length === 0 && !editing ? (
        <div className="rounded-2xl border border-dashed border-border-strong px-6 py-16 text-center">
          <p className="text-base font-semibold">No campaigns yet</p>
          <p className="mt-1 text-muted-foreground">Joined a clipping campaign? Save its rules here.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {list.map((c) => (
            <article key={c.id} className="rounded-2xl border bg-panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">{c.name}</h2>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {c.streamer || "Any streamer"} · {c.language === "en" ? "English" : "Hindi / Hinglish"}
                    {c.mention && ` · captions mention “${c.mention}”`}
                  </p>
                </div>
                <span className="flex gap-1">
                  {c.link && (
                    <a href={c.link} target="_blank" rel="noopener noreferrer" className={cn(btn, btnSm, btnGhost)}>
                      <ExternalLink aria-hidden="true" /> Open
                    </a>
                  )}
                  <button type="button" onClick={() => setEditing({ id: c.id, draft: toDraft(c) })} className={cn(btn, btnSm, btnGhost)}>
                    <Pencil aria-hidden="true" /> Edit
                  </button>
                  <button type="button" onClick={() => remove(c)} aria-label={`Delete ${c.name}`} className={cn(btn, btnSm, btnGhost, "w-[34px] px-0 hover:text-bad")}>
                    <Trash2 aria-hidden="true" />
                  </button>
                </span>
              </div>
              {[...c.hashtags, ...c.extraTags].length > 0 && (
                <p className="mt-2.5 flex flex-wrap gap-1.5">
                  {c.hashtags.map((t) => (
                    <span key={t} className="rounded-full bg-moment px-2 py-0.5 text-xs font-semibold text-moment-ink">
                      {t}
                    </span>
                  ))}
                  {c.extraTags.map((t) => (
                    <span key={t} className="rounded-full bg-raised px-2 py-0.5 text-xs text-muted-foreground">
                      {t}
                    </span>
                  ))}
                </p>
              )}
              {(c.keywords ?? []).length > 0 && <p className="mt-2.5 text-[13px] text-muted-foreground"><b className="font-medium text-foreground">Title words:</b> {c.keywords.join(", ")}</p>}
              {c.lookFor && <p className="mt-2.5 text-[13px] text-muted-foreground"><b className="font-medium text-foreground">Look for:</b> {c.lookFor}</p>}
              {c.avoid && <p className="mt-1 text-[13px] text-muted-foreground"><b className="font-medium text-foreground">Avoid:</b> {c.avoid}</p>}
            </article>
          ))}
        </div>
      )}
      <Toast msg={toast.msg} />
    </div>
  );
}
