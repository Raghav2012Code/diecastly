/**
 * One decision for what a paginated list page should render.
 *
 * All three admin list pages shared the same shape — "no rows? show the empty
 * state" — and all three therefore shared the same defect: a page past the end
 * of the result set rendered the "nothing here yet" copy with no pagination,
 * so the admin was told a populated catalog was empty and offered a link to
 * create a product that already existed. The pagination component already
 * computed the clamp; it simply was not rendered on that path.
 *
 * The distinguishing question is whether the requested page exists at all.
 * `pageCount` is derived from the total, which only the query knows, so this
 * cannot be decided in the data layer — hence a single shared function rather
 * than three inline comparisons.
 */

export type ListState = "error" | "out-of-range" | "no-matches" | "empty" | "rows";

export function resolveListState(input: {
  ok: boolean;
  rowCount: number;
  total: number;
  page: number;
  pageSize: number;
  hasFilters: boolean;
}): ListState {
  if (!input.ok) return "error";
  if (input.rowCount > 0) return "rows";

  // Does the requested page exist? Checked before the empty cases, because an
  // out-of-range page is out of range whether or not filters are active.
  const pageCount = Math.max(1, Math.ceil(input.total / Math.max(1, input.pageSize)));
  if (input.page > pageCount) return "out-of-range";

  return input.hasFilters ? "no-matches" : "empty";
}

/** The last page that actually has rows. Used to offer a way back. */
export function lastPage(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}
