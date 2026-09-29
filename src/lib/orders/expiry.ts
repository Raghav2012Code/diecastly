/**
 * Stock-hold expiry state for an open order.
 *
 * `orders.expires_at` (D18) marks stock held by an unpaid online order. The
 * queue and the order detail need the same reading of it — overdue or not —
 * so it lives here rather than inline in two components.
 */
export type ExpiryState = "none" | "upcoming" | "overdue";

export function expiryState(expiresAt: string | null | undefined, now = Date.now()): ExpiryState {
  if (!expiresAt) return "none";
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return "none";
  return at < now ? "overdue" : "upcoming";
}
