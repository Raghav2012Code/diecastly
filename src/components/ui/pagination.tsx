import Link from "next/link";
import { cn } from "@/lib/utils";

function hrefFor(
  basePath: string,
  params: Record<string, string | undefined>,
  page: number,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  if (page > 1) search.set("page", String(page));
  else search.delete("page");
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

const linkClass =
  "inline-flex h-8 items-center rounded-md border border-input bg-card px-3 text-sm font-medium transition-colors hover:bg-secondary";
const disabledClass = "pointer-events-none opacity-40";

export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params = {},
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const clampedPage = Math.min(Math.max(1, page), pageCount);

  const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1).filter(
    (candidate) =>
      candidate === 1 ||
      candidate === pageCount ||
      Math.abs(candidate - clampedPage) <= 1,
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="tnum text-xs text-muted-foreground">
        Showing {first}–{last} of {total}
      </p>
      <div className="flex items-center gap-1">
        <Link
          href={hrefFor(basePath, params, Math.max(1, clampedPage - 1))}
          aria-disabled={clampedPage <= 1}
          className={cn(linkClass, clampedPage <= 1 && disabledClass)}
        >
          Previous
        </Link>
        {pageNumbers.map((candidate, index) => (
          <span key={candidate} className="flex items-center gap-1">
            {index > 0 && candidate - pageNumbers[index - 1] > 1 ? (
              <span aria-hidden className="px-1 text-xs text-muted-foreground">
                …
              </span>
            ) : null}
            <Link
              href={hrefFor(basePath, params, candidate)}
              aria-current={candidate === clampedPage ? "page" : undefined}
              className={cn(
                "inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm tnum transition-colors",
                candidate === clampedPage
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-card hover:bg-secondary",
              )}
            >
              {candidate}
            </Link>
          </span>
        ))}
        <Link
          href={hrefFor(basePath, params, Math.min(pageCount, clampedPage + 1))}
          aria-disabled={clampedPage >= pageCount}
          className={cn(linkClass, clampedPage >= pageCount && disabledClass)}
        >
          Next
        </Link>
      </div>
    </div>
  );
}
