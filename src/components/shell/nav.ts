import { CalendarDays, Film, GalleryHorizontalEnd, House, LayoutGrid, ChartLine, type LucideIcon } from "lucide-react";

export type NavItem = {
  label: string;
  /** Shorter label for the phone tab bar. */
  short?: string;
  href?: string;
  icon: LucideIcon;
  count?: number;
  isNew?: boolean;
  /** Shown in the phone tab bar. */
  mobile?: boolean;
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Create",
    items: [
      { label: "Home", href: "/", icon: House, mobile: true },
      { label: "Clips", href: "/clips", icon: GalleryHorizontalEnd, mobile: true },
      { label: "Narration video", short: "Narration", href: "/narration", icon: Film, isNew: true, mobile: true },
    ],
  },
  {
    label: "Publish",
    items: [
      { label: "Schedule", href: "/schedule", icon: CalendarDays, mobile: true },
      { label: "Analytics", icon: ChartLine },
    ],
  },
  {
    label: "Brand",
    items: [{ label: "Brand kit", icon: LayoutGrid }],
  },
];

export function isActive(pathname: string, href: string) {
  if (href === "/clips" && pathname.startsWith("/p/")) return true; // an upload's clips live under /p/<id>
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

const CRUMBS: Record<string, string[]> = {
  "/": ["Home"],
  "/clips": ["Clips", "Night run downtown"],
  "/narration": ["Narration video"],
  "/schedule": ["Schedule"],
};

export function getCrumbs(pathname: string) {
  if (/^\/clips\/[^/]+\/edit$/.test(pathname)) return ["Clips", "Night run downtown", "Edit"];
  if (pathname.startsWith("/p/")) return ["Clips", "Your upload"];
  return CRUMBS[pathname] ?? ["Home"];
}
