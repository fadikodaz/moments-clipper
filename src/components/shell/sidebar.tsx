"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { NAV, isActive } from "./nav";

export function Sidebar() {
  return <SidebarView pathname={usePathname()} />;
}

/** Rendered with an empty path while the URL is still unknown (dynamic routes), then with the real one. */
export function SidebarView({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Main" className="sticky top-0 hidden h-dvh w-[220px] shrink-0 flex-col gap-1 border-r bg-sidebar px-3 py-4 md:flex">
      <Link href="/" aria-label="Moments, new shorts" className="px-2 pt-0.5 pb-[18px]">
        <Logo />
      </Link>
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-[38px] items-center gap-2.5 rounded-[10px] px-2.5 text-sm font-medium text-muted-foreground hover:bg-raised hover:text-foreground",
              active && "bg-raised text-foreground",
            )}
          >
            <Icon className="size-[18px]" strokeWidth={2} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileTabBar() {
  return <MobileTabBarView pathname={usePathname()} />;
}

export function MobileTabBarView({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 flex h-[60px] border-t bg-sidebar md:hidden">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn("grid flex-1 place-items-center content-center gap-[3px] text-[11px] text-muted-foreground", active && "text-foreground")}
          >
            <Icon className="size-[18px]" strokeWidth={2} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
