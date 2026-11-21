"use client";

/**
 * Confirm and name-it dialogs that match the app, instead of the browser's confirm() and prompt().
 *   const { confirm, prompt } = useDialogs();
 *   if (!(await confirm({ title: "Delete this short?", body: "…", action: "Delete", danger: true }))) return;
 *   const name = await prompt({ title: "Name this look", initial: "Kai style", action: "Save" });  // null = cancelled
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";

type ConfirmOpts = { title: string; body?: ReactNode; action: string; cancel?: string; danger?: boolean };
type PromptOpts = { title: string; body?: ReactNode; label?: string; initial?: string; action: string; placeholder?: string };
type Ctx = { confirm: (o: ConfirmOpts) => Promise<boolean>; prompt: (o: PromptOpts) => Promise<string | null> };

const DialogCtx = createContext<Ctx | null>(null);

export function useDialogs() {
  const c = useContext(DialogCtx);
  if (!c) throw new Error("useDialogs needs <DialogProvider> (app/layout.tsx)");
  return c;
}

const backdrop = "fixed inset-0 z-50 bg-[rgb(8_11_20/0.62)] backdrop-blur-[3px] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0";
const panel =
  "fixed top-1/2 left-1/2 z-50 grid w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 gap-2.5 rounded-[18px] border border-border-strong bg-raised p-[22px] shadow-[0_30px_80px_rgb(5_8_16/0.6)] outline-none transition-[opacity,transform] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0";
const title = "font-heading text-xl font-bold tracking-[-0.02em]";
const body = "text-sm text-muted-foreground";
const button = "inline-flex h-10 cursor-pointer items-center justify-center rounded-[10px] border px-4 text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moment";

export function DialogProvider({ children }: { children: ReactNode }) {
  const [c, setC] = useState<(ConfirmOpts & { open: boolean }) | null>(null);
  const [p, setP] = useState<(PromptOpts & { open: boolean }) | null>(null);
  const resolveC = useRef<(v: boolean) => void>(() => {});
  const resolveP = useRef<(v: string | null) => void>(() => {});
  const input = useRef<HTMLInputElement>(null);

  const confirm = useCallback((o: ConfirmOpts) => {
    setC({ ...o, open: true });
    return new Promise<boolean>((res) => (resolveC.current = res));
  }, []);
  const prompt = useCallback((o: PromptOpts) => {
    setP({ ...o, open: true });
    return new Promise<string | null>((res) => (resolveP.current = res));
  }, []);

  function closeC(v: boolean) {
    resolveC.current(v);
    setC((x) => (x ? { ...x, open: false } : x));
  }
  function closeP(v: string | null) {
    resolveP.current(v);
    setP((x) => (x ? { ...x, open: false } : x));
  }

  return (
    <DialogCtx.Provider value={{ confirm, prompt }}>
      {children}

      <AlertDialog.Root open={!!c?.open} onOpenChange={(o) => !o && closeC(false)}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className={backdrop} />
          <AlertDialog.Popup className={panel}>
            <AlertDialog.Title className={title}>{c?.title}</AlertDialog.Title>
            {c?.body && <AlertDialog.Description className={body}>{c.body}</AlertDialog.Description>}
            <div className="mt-2.5 flex justify-end gap-2">
              <AlertDialog.Close className={cn(button, "border-transparent bg-transparent text-muted-foreground hover:bg-panel hover:text-foreground")}>{c?.cancel ?? "Cancel"}</AlertDialog.Close>
              <button type="button" onClick={() => closeC(true)} className={cn(button, c?.danger ? "border-bad bg-bad text-white hover:brightness-110" : "border-moment bg-moment text-moment-ink hover:brightness-105")}>
                {c?.action}
              </button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <Dialog.Root open={!!p?.open} onOpenChange={(o) => !o && closeP(null)}>
        <Dialog.Portal>
          <Dialog.Backdrop className={backdrop} />
          <Dialog.Popup className={panel} initialFocus={input}>
            <Dialog.Title className={title}>{p?.title}</Dialog.Title>
            {p?.body && <Dialog.Description className={body}>{p.body}</Dialog.Description>}
            <form
              className="grid gap-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                const v = input.current?.value.trim();
                if (v) closeP(v);
              }}
            >
              <label className="mt-1 grid gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground">{p?.label ?? "Name"}</span>
                <input
                  ref={input}
                  key={p?.title + String(p?.initial)}
                  defaultValue={p?.initial ?? ""}
                  placeholder={p?.placeholder}
                  className="h-[42px] rounded-[10px] border bg-panel px-3 text-[15px] outline-none hover:border-border-strong focus:border-moment"
                />
              </label>
              <div className="mt-2.5 flex justify-end gap-2">
                <Dialog.Close className={cn(button, "border-transparent bg-transparent text-muted-foreground hover:bg-panel hover:text-foreground")}>Cancel</Dialog.Close>
                <button type="submit" className={cn(button, "border-moment bg-moment text-moment-ink hover:brightness-105")}>
                  {p?.action}
                </button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </DialogCtx.Provider>
  );
}
