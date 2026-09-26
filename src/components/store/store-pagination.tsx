import * as React from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Catalog pagination as links.
 *
 * Real links rather than buttons, so each page is addressable, crawlable and
 * openable in a new tab. A client-side pager would make the second page of the
 * catalog unreachable by URL, which is both a usability loss and a search-engine
 * one.
 *
 * The existing filters are carried through every link, so paging never silently
 * drops the search the shopper applied.
 */
export function StorePagination({
  page,
  pages,
  params,
}: {
  page: number;
  pages: number;
  params: { search?: string; categoryId?: string; series?: string; sort?: string };
}) {
  function href(target: number): string {
    const query = new URLSearchParams();
    if (params.search) query.set("search", params.search);
    if (params.categoryId) query.set("category", params.categoryId);
    if (params.series) query.set("series", params.series);
    if (params.sort) query.set("sort", params.sort);
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return text ? `/?${text}` : "/";
  }

  // A short window around the current page: first, last, and the neighbours,
  // with gaps marked. A full 1..N list is unusable past a handful of pages.
  const window = new Set<number>([1, pages, page, page - 1, page + 1]);
  const shown = [...window].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);

  return (
    <nav className="mt-8 flex items-center justify-center gap-1" aria-label="Catalog pages">
      {page > 1 ? (
        <Link href={href(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Previous
        </Link>
      ) : null}

      {shown.map((n, index) => {
        const previous = shown[index - 1];
        return (
          <React.Fragment key={n}>
            {previous !== undefined && n - previous > 1 ? (
              <span className="px-1 text-muted-foreground" aria-hidden>
                …
              </span>
            ) : null}
            <Link
              href={href(n)}
              aria-current={n === page ? "page" : undefined}
              className={cn(
                buttonVariants({ variant: n === page ? "default" : "ghost", size: "sm" }),
                "min-w-9",
              )}
            >
              {n}
            </Link>
          </React.Fragment>
        );
      })}

      {page < pages ? (
        <Link href={href(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Next
        </Link>
      ) : null}
    </nav>
  );
}
