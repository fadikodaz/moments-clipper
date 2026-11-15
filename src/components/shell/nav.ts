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
      { label: "Clips", href: "/clips", icon: GalleryHorizontalEnd, count: 12, mobile: true },
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
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

export const CRUMBS: Record<string, string[]> = {
  "/": ["Home"],
  "/clips": ["Clips"],
  "/narration": ["Narration video"],
  "/schedule": ["Schedule"],
};
