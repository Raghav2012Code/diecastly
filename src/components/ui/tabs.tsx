import Link from "next/link";
import { cn } from "@/lib/utils";

export type TabItem = {
  href: string;
  label: string;
  active: boolean;
  count?: number;
};

export function Tabs({ items, className }: { items: TabItem[]; className?: string }) {
  return (
    <nav
      aria-label="Section tabs"
      className={cn("flex items-stretch gap-1 overflow-x-auto border-b border-border", className)}
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            item.active
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
          )}
        >
          {item.label}
          {typeof item.count === "number" ? (
            <span className="tnum rounded-sm bg-secondary px-1.5 text-xs text-muted-foreground">
              {item.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
