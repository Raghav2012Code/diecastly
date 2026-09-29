/**
 * Shared search-term sanitizer for PostgREST `or` filters.
 *
 * Comma, parentheses, star, percent, underscore and backslash are the
 * characters PostgREST's `or=(...)` filter treats as syntax. A search term is
 * attacker-controlled, so leaving them in would let a crafted query change the
 * filter's meaning rather than search for what was typed — e.g. a shopper
 * searching `Hot Wheels (R34)` would terminate the group and the public
 * catalog would render "could not be loaded".
 *
 * Stripped rather than escaped because `ilike` has no escape parameter here,
 * and a search for "50%" legitimately matching everything is a far better
 * failure than a filter that can be rewritten.
 */
export function sanitizeSearchTerm(term: string): string {
  return term
    .replace(/[,()*%_\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
