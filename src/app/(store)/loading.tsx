import { Skeleton } from "@/components/ui/skeleton";

/**
 * Catalog loading skeleton.
 *
 * Mirrors the real grid's shape — a heading band, a filter row, then a four-up
 * grid of image-and-text cards — so the layout does not jump when the data lands.
 * A spinner here would collapse the whole page to one line and then push
 * everything down, which is worse on a slow connection than doing nothing.
 */
export default function StoreCatalogLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-32" />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Skeleton className="h-9 min-w-48 flex-1" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-24" />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-border bg-card">
            <Skeleton className="aspect-square w-full rounded-none" />
            <div className="space-y-2 p-3">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
