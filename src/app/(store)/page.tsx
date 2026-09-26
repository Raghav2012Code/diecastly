import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { ProductCard } from "@/components/store/product-card";
import { CatalogFilters } from "@/components/store/catalog-filters";
import { StorePagination } from "@/components/store/store-pagination";
import { listPublicCategories, listPublicProducts, listPublicSeries } from "@/lib/store/data";
import { categoryId, searchTerm, seriesName, storefrontSort } from "@/lib/store/params";
import { pageNumber } from "@/lib/list-params";
import { lastPage, resolveListState } from "@/lib/list-state";

export const metadata = { title: "Catalog" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The public catalog.
 *
 * A server component: the catalog is public, cacheable and identical for
 * everyone, and there is no per-visitor state to render. Filtering is by plain
 * links and a GET form, so a filtered catalog is bookmarkable and shareable, and
 * the back button behaves — the alternative, client-side filtering, would make
 * every one of those impossible.
 *
 * The list state decision is the shared `resolveListState`, so a page past the
 * end of the results offers a way back instead of claiming the shop is empty.
 */
export default async function StoreCatalogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const search = searchTerm(params.search);
  const category = categoryId(params.category);
  const series = seriesName(params.series);
  const sort = storefrontSort(params.sort);
  const page = pageNumber(params.page);

  const [products, categories, seriesList] = await Promise.all([
    listPublicProducts({ search, categoryId: category, series, sort, page }),
    listPublicCategories(),
    listPublicSeries(),
  ]);

  // A failed read must not render an empty shop: an empty grid reads as "we have
  // nothing in stock", which is a materially different and completely wrong claim.
  if (!products.ok) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <EmptyState
          title="The catalog could not be loaded"
          description="Something went wrong reaching the shop. Please try again in a moment."
          action={
            <Link href="/" className={buttonVariants()}>
              Try again
            </Link>
          }
        />
      </div>
    );
  }

  const { rows, total, pageSize } = products.data;
  const categoryRows = categories.ok ? categories.data : [];
  const seriesOptions = seriesList.ok ? seriesList.data : [];
  const hasFilters = Boolean(search || category || series);

  const state = resolveListState({
    ok: true,
    rowCount: rows.length,
    total,
    page,
    pageSize,
    hasFilters,
  });

  const pages = lastPage(total, pageSize);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-6 space-y-1">
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          The collection
        </h1>
        <p className="text-sm text-muted-foreground">
          {total === 0
            ? "No products yet."
            : `${total} product${total === 1 ? "" : "s"} available`}
        </p>
      </div>

      <CatalogFilters
        categories={categoryRows.map((c) => ({ id: c.id, name: c.name }))}
        series={seriesOptions}
        current={{ search, categoryId: category, series, sort }}
      />

      {state === "out-of-range" ? (
        <div className="mt-8">
          <EmptyState
            title="That page is past the end"
            description={`There ${total === 1 ? "is" : "are"} ${total} product${total === 1 ? "" : "s"} in total, across ${pages} page${pages === 1 ? "" : "s"}.`}
            action={
              <Link href="/" className={buttonVariants()}>
                Back to the catalog
              </Link>
            }
          />
        </div>
      ) : state === "no-matches" ? (
        <div className="mt-8">
          <EmptyState
            title="Nothing matched those filters"
            description="Try a different search, or clear the filters to see everything."
            action={
              <Link href="/" className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            }
          />
        </div>
      ) : state === "empty" ? (
        <div className="mt-8">
          <EmptyState
            title="The shop is empty for now"
            description="Nothing is listed yet. Please check back soon."
          />
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {rows.map((product, index) => (
              <ProductCard key={product.id} product={product} priority={index < 4} />
            ))}
          </div>

          {pages > 1 ? (
            <StorePagination
              page={page}
              pages={pages}
              params={{ search, categoryId: category, series, sort }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
