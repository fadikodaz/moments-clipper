/* Shared class names (no "use client": server and client components both import these). */
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
