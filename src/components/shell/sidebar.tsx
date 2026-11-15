"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { user } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { NAV, isActive, type NavItem } from "./nav";

const itemBase =
  "relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors [&_svg]:size-4 [&_svg]:shrink-0";

function SideItem({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const inner = (
    <>
      <Icon strokeWidth={1.75} aria-hidden="true" />
      {item.label}
      {item.count != null && <span className="ml-auto font-mono text-[11px] font-medium text-subtle">{item.count}</span>}
      {item.isNew && <span className="ml-auto rounded-full bg-moment-soft px-1.5 text-[10px] font-semibold text-moment">New</span>}
      {!item.href && <span className="ml-auto text-[10px] text-subtle">Soon</span>}
    </>
  );

  if (!item.href) {
    return (
      <span className={cn(itemBase, "cursor-default opacity-70")} aria-disabled="true">
        {inner}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        itemBase,
        "hover:bg-raised hover:text-foreground",
        active && "bg-raised text-foreground before:absolute before:inset-y-2 before:-left-2.5 before:w-0.5 before:rounded-full before:bg-moment",
      )}
    >
      {inner}
    </Link>
  );
}

export function Sidebar() {
  return <SidebarView pathname={usePathname()} />;
}

/** Rendered with an empty path while the URL is still unknown (dynamic routes), then with the real one. */
export function SidebarView({ pathname }: { pathname: string }) {
  const pct = Math.round((user.hoursUsed / user.hoursLimit) * 100);

  return (
    <nav aria-label="Main" className="hidden h-dvh w-[228px] shrink-0 flex-col gap-3.5 border-r bg-sidebar px-2.5 pt-3.5 pb-3 sm:flex">
      <Link href="/" aria-label="Moments home" className="px-2 pt-1 pb-1.5">
        <Logo />
      </Link>

      {NAV.map((group) => (
        <div key={group.label} className="grid gap-px">
          <span className="px-2.5 pb-1 text-[11px] text-subtle">{group.label}</span>
          {group.items.map((item) => (
            <SideItem key={item.label} item={item} active={!!item.href && isActive(pathname, item.href)} />
          ))}
        </div>
      ))}

      <div className="flex-1" />

      <div className="grid gap-2 rounded-lg border bg-panel p-3">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Hours this month</span>
          <b className="font-mono text-[11px] font-medium text-foreground">
            {user.hoursUsed} / {user.hoursLimit}
          </b>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Hours used this month">
          <i className="block h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-subtle">Plans and upgrades arrive with billing</span>
      </div>

      <div className="flex items-center gap-2.5 px-1.5">
        <span className="grid size-[30px] shrink-0 place-items-center rounded-full border border-border-strong bg-gradient-to-br from-border-strong to-hover text-xs font-semibold">
          {user.name[0]}
        </span>
        <span className="leading-tight">
          <b className="block text-[13px] font-medium">{user.name}</b>
          <small className="text-[11px] text-subtle">{user.plan}</small>
        </span>
      </div>
    </nav>
  );
}

export function MobileTabBar() {
  return <MobileTabBarView pathname={usePathname()} />;
}

export function MobileTabBarView({ pathname }: { pathname: string }) {
  const items = NAV.flatMap((g) => g.items).filter((i) => i.mobile && i.href);

  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 flex h-[58px] items-center justify-center border-t bg-sidebar px-1.5 sm:hidden">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href!);
        return (
          <Link
            key={item.label}
            href={item.href!}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-[50px] max-w-24 flex-1 flex-col items-center justify-center gap-1 rounded-md text-[10.5px] text-muted-foreground",
              active && "bg-raised text-foreground after:absolute after:inset-x-[30%] after:-bottom-1 after:h-0.5 after:rounded-full after:bg-moment",
            )}
          >
            <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
            {item.short ?? item.label}
          </Link>
        );
      })}
    </nav>
  );
}
