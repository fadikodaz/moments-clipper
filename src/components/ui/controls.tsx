"use client";

/**
 * The app's form controls, built on Base UI so every dropdown, slider, switch, checkbox,
 * colour picker and fold-out looks and behaves the same (keyboard, focus, screen readers).
 */
import type { ReactNode } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Collapsible } from "@base-ui/react/collapsible";
import { Popover } from "@base-ui/react/popover";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";

const popup =
  "origin-[var(--transform-origin)] rounded-xl border border-border-strong bg-raised p-1.5 text-foreground shadow-[0_18px_50px_rgb(5_8_16/0.55)] outline-none transition-[opacity,transform] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0";

export const fieldLabel = "text-xs font-semibold text-muted-foreground";

/* ---------------- dropdown ---------------- */

type SelectProps<T extends string> = {
  value: T;
  options: readonly (readonly [T, ReactNode])[];
  onChange: (v: T) => void;
  label?: string;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
};

export function Select<T extends string>({ value, options, onChange, label, ariaLabel, disabled, className, size = "md" }: SelectProps<T>) {
  const items = options.map(([v, l]) => ({ value: v, label: l }));
  return (
    <BaseSelect.Root items={items} value={value} onValueChange={(v) => v != null && onChange(v as T)} disabled={disabled}>
      <div className={cn("grid gap-1.5", className)}>
        {label && <BaseSelect.Label className={fieldLabel}>{label}</BaseSelect.Label>}
        <BaseSelect.Trigger
          aria-label={label ? undefined : ariaLabel}
          className={cn(
            "flex w-full min-w-0 cursor-pointer items-center justify-between gap-2.5 rounded-[10px] border bg-panel pr-2.5 pl-3 text-left font-medium text-foreground outline-none hover:border-border-strong focus-visible:border-moment data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[popup-open]:border-border-strong",
            size === "sm" ? "h-[34px] text-[13px]" : "h-10 text-sm",
          )}
        >
          <BaseSelect.Value className="truncate" />
          <BaseSelect.Icon className="text-muted-foreground transition-transform data-[popup-open]:rotate-180">
            <ChevronDown className="size-4" aria-hidden="true" />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
      </div>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="z-50 outline-none" sideOffset={6} alignItemWithTrigger={false}>
          <BaseSelect.Popup className={cn(popup, "min-w-[var(--anchor-width)]")}>
            <BaseSelect.List className="max-h-[min(320px,var(--available-height))] overflow-y-auto">
              {items.map((it) => (
                <BaseSelect.Item
                  key={it.value}
                  value={it.value}
                  className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium outline-none select-none data-[highlighted]:bg-hover"
                >
                  <BaseSelect.ItemText className="flex-1 truncate">{it.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="text-moment">
                    <Check className="size-4" aria-hidden="true" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

/* ---------------- slider ---------------- */

const thumb =
  "block size-[18px] rounded-full bg-foreground shadow-[0_0_0_4px_var(--panel)] outline-none focus-visible:shadow-[0_0_0_4px_var(--panel),0_0_0_6px_var(--moment)] data-[dragging]:scale-110";

/** One value. `shown` replaces the number on the right (e.g. "62%"). */
export function Slider({ label, value, shown, min, max, step = 1, onChange, disabled, ariaLabel }: { label?: string; value: number; shown?: string; min: number; max: number; step?: number; onChange: (v: number) => void; disabled?: boolean; ariaLabel?: string }) {
  return (
    <BaseSlider.Root value={value} min={min} max={max} step={step} disabled={disabled} onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)} className="grid gap-2 data-[disabled]:opacity-45">
      {label && (
        <span className="flex justify-between">
          <BaseSlider.Label className={fieldLabel}>{label}</BaseSlider.Label>
          <span className="text-xs font-semibold text-foreground">{shown ?? value}</span>
        </span>
      )}
      <BaseSlider.Control className="flex h-5 w-full cursor-pointer touch-none items-center">
        <BaseSlider.Track className="relative h-1 w-full rounded-full bg-border">
          <BaseSlider.Indicator className="rounded-full bg-foreground" />
          <BaseSlider.Thumb aria-label={label ? undefined : ariaLabel} className={thumb} />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}

/** Two thumbs: shortest and longest, from and to. */
export function RangeSlider({ value, min, max, step = 1, onChange, labels }: { value: [number, number]; min: number; max: number; step?: number; onChange: (v: [number, number]) => void; labels: [string, string] }) {
  return (
    <BaseSlider.Root value={value} min={min} max={max} step={step} minStepsBetweenValues={1} onValueChange={(v) => Array.isArray(v) && onChange([v[0], v[1]])}>
      <BaseSlider.Control className="flex h-5 w-full cursor-pointer touch-none items-center">
        <BaseSlider.Track className="relative h-1 w-full rounded-full bg-border">
          <BaseSlider.Indicator className="rounded-full bg-foreground" />
          <BaseSlider.Thumb index={0} aria-label={labels[0]} className={thumb} />
          <BaseSlider.Thumb index={1} aria-label={labels[1]} className={thumb} />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}

/* ---------------- switch and checkbox ---------------- */

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <BaseSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={label}
      className="relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer rounded-full bg-border-strong p-[3px] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-moment data-[checked]:bg-foreground data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40"
    >
      <BaseSwitch.Thumb className="size-4 rounded-full bg-foreground transition-transform data-[checked]:translate-x-4 data-[checked]:bg-background" />
    </BaseSwitch.Root>
  );
}

export function Checkbox({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2.5 text-[13px] font-medium", disabled && "cursor-not-allowed opacity-45")}>
      <BaseCheckbox.Root
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="grid size-[18px] shrink-0 place-items-center rounded-[5px] border border-border-strong bg-panel outline-none focus-visible:outline-2 focus-visible:outline-moment data-[checked]:border-foreground data-[checked]:bg-foreground"
      >
        <BaseCheckbox.Indicator className="text-background">
          <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      {children}
    </label>
  );
}

/* ---------------- colour ---------------- */

const SWATCHES = ["#ffffff", "#ffd23f", "#ff7448", "#ff5c6c", "#5bd69a", "#7aa2ff", "#c084fc", "#000000"];

/** A swatch that opens a small panel: common caption colours plus a hex field. */
export function ColorPick({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const hex = /^#[0-9a-f]{6}$/i;
  return (
    <div className={cn("grid gap-1.5", disabled && "pointer-events-none opacity-40")}>
      <span className={fieldLabel}>{label}</span>
      <Popover.Root>
        <Popover.Trigger
          disabled={disabled}
          className="flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-[10px] border bg-panel px-2.5 text-sm font-medium uppercase outline-none hover:border-border-strong focus-visible:border-moment data-[popup-open]:border-border-strong"
        >
          <span className="size-[22px] rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)]" style={{ background: value }} />
          {value}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner className="z-50" sideOffset={6} align="start">
            <Popover.Popup className={cn(popup, "grid w-[232px] gap-3 p-3")}>
              <Popover.Title className="sr-only">{label}</Popover.Title>
              <div className="grid grid-cols-4 gap-2">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    aria-pressed={value.toLowerCase() === c}
                    onClick={() => onChange(c)}
                    className="aspect-square cursor-pointer rounded-full border-2 border-transparent shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)] aria-pressed:border-foreground"
                    style={{ background: c }}
                  />
                ))}
              </div>
              <input
                key={value}
                defaultValue={value}
                aria-label={`${label}, hex code`}
                onBlur={(e) => hex.test(e.target.value) && onChange(e.target.value.toLowerCase())}
                onKeyDown={(e) => e.key === "Enter" && hex.test(e.currentTarget.value) && onChange(e.currentTarget.value.toLowerCase())}
                className="h-9 rounded-lg border bg-panel px-2.5 text-sm uppercase outline-none focus:border-moment"
              />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

/* ---------------- fold-out ---------------- */

/** Extra settings, closed by default so each panel stays calm. */
export function Fold({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Collapsible.Root className={cn("border-t pt-3.5", className)}>
      <Collapsible.Trigger className="group flex cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground">
        <Plus className="size-4 transition-transform group-data-[panel-open]:rotate-45" aria-hidden="true" />
        {title}
      </Collapsible.Trigger>
      <Collapsible.Panel className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 data-[ending-style]:h-0 data-[starting-style]:h-0">
        <div className="grid gap-4 pt-3.5">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
