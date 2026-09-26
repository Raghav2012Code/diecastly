"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV } from "@/lib/admin-nav";
import { cn } from "@/lib/utils";

/**
 * Admin navigation.
 *
 * One implementation, two orientations, so the active-state rule cannot drift
 * between them: the sidebar is `hidden md:flex`, so without the bar variant the
 * entire admin had NO navigation below 768px and an admin who opened a link to
 * /admin/orders on a phone was stranded with no way to reach anything else.
 *
 * "Desktop-first" is a statement about density, not about being unusable on a
 * small screen, and a missing nav is an omission rather than a design choice.
 *
 * `badges` carries the low-stock count onto the Inventory item. It comes from the
 * server as a plain number so the nav stays a client component, and it is
 * optional so the preview harness and the login-adjacent states can omit it.
 */
export function AdminNav({
  orientation = "sidebar",
  lowStockCount = 0,
}: {
  orientation?: "sidebar" | "bar";
  lowStockCount?: number;
}) {
  const pathname = usePathname();
  const bar = orientation === "bar";

  return (
    <nav
      aria-label="Admin sections"
      className={cn(
        bar
          ? "flex gap-1 overflow-x-auto pb-1 md:hidden"
          : "flex flex-col gap-0.5",
      )}
    >
      {ADMIN_NAV.map((item) => {
        const active =
          item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        const Icon = item.icon;
        const lowStock = item.href === "/admin/inventory" && lowStockCount > 0;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              bar ? "shrink-0 whitespace-nowrap" : "",
              active
                ? "bg-white/10 font-semibold text-petrol-foreground"
                : "text-petrol-foreground/70 hover:bg-white/5 hover:text-petrol-foreground",
            )}
          >
            {active && !bar ? (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary"
              />
            ) : null}
            <Icon aria-hidden className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.label}</span>

            {lowStock ? (
              <>
                <span
                  className={cn(
                    "ml-auto inline-grid h-5 min-w-5 place-items-center rounded-full px-1 text-xs font-semibold",
                    bar ? "ml-1.5" : "",
                    "bg-warning/20 text-warning",
                  )}
                >
                  {lowStockCount}
                </span>
                {/* The number is visual; this is what a screen reader hears, so the
                    badge is not silently invisible. */}
                <span className="sr-only">
                  {`${lowStockCount} product${lowStockCount === 1 ? "" : "s"} low on stock`}
                </span>
              </>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
