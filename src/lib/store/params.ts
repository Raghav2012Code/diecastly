import { oneOf, pageNumber } from "@/lib/list-params";

/**
 * Search-parameter parsing for the public catalog.
 *
 * The admin lists had this problem already: a type assertion has no runtime
 * effect, so `?stock=bogus` reached the query and silently became a valid-looking
 * filter while the control — having no matching option — displayed something
 * else. A stale bookmark or a mistyped link is enough to reach it.
 *
 * The storefront needs the same discipline, and one thing more: these parameters
 * are reachable by anyone, not just an admin, so an unrecognised value must be
 * treated as absent rather than substituted.
 */

export const STOREFRONT_SORT_VALUES = ["newest", "price_asc", "price_desc", "name"] as const;
export type StorefrontSort = (typeof STOREFRONT_SORT_VALUES)[number];

/**
 * Newest first is the default, so there is deliberately no "all" member: the
 * storefront has nothing to turn the sort off, and adding one would mean the
 * control showing "All products" while the query silently applied newest-first.
 * An unrecognised value falls back to the default rather than being substituted.
 */
export const storefrontSort = (value: string | string[] | undefined): StorefrontSort =>
  oneOf(value, STOREFRONT_SORT_VALUES) ?? "newest";

/**
 * A category id, accepted only if it looks like a uuid.
 *
 * Checked rather than passed through because it goes straight into an equality
 * filter on a uuid column; a malformed value would be a database error surfaced
 * as "something went wrong" on a public page.
 */
export function categoryId(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== "string" || first.length === 0) return undefined;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(first)
    ? first
    : undefined;
}

/**
 * A search term, trimmed and length-capped.
 *
 * Capped because it is interpolated into a PostgREST `or` filter, and an
 * unbounded term is both a slow query and a long URL. 120 characters is well
 * past any real product name.
 */
export function searchTerm(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== "string") return undefined;
  const trimmed = first.trim().slice(0, 120);
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * A series name for the filter.
 *
 * Any printable string is accepted, because series are free text chosen by the
 * seller rather than a controlled enumeration — so unlike a status or a sort
 * order there is no list to validate against. An exact match is used, so a
 * partial one would silently return nothing.
 */
export function seriesName(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== "string") return undefined;
  const trimmed = first.trim().slice(0, 120);
  return trimmed.length > 0 ? trimmed : undefined;
}

export { pageNumber };
