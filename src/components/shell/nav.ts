import { FolderOpen, Plus, type LucideIcon } from "lucide-react";

export type NavItem = { label: string; href: string; icon: LucideIcon };

/** Only what works. New entries come back when their feature is real. */
export const NAV: NavItem[] = [
  { label: "New clips", href: "/", icon: Plus },
  { label: "Projects", href: "/projects", icon: FolderOpen },
];

export function isActive(pathname: string, href: string) {
  if (href === "/projects" && pathname.startsWith("/p/")) return true; // a project lives under /p/<id>
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}
