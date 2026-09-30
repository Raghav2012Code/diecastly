import { z } from "zod";
import type { OrderStatus } from "@/lib/types/database.types";

/**
 * Fulfilment transitions and cancellation, as the admin sees them.
 *
 * `update_order_status` in SQL is a strict linear chain:
 *
 *   pending -> confirmed -> packed -> shipped -> delivered -> completed
 *
 * with `cancelled` and `returned` refused outright and routed to `cancel_order`.
 * The map below MIRRORS that table so the UI can offer exactly one forward
 * action. It is a mirror, not the authority: the RPC re-checks the transition
 * against the order's current status, so a stale screen offering the wrong
 * button gets `invalid_transition` rather than a bad state change.
 *
 * The duplication is deliberate. Encoding the chain in SQL and asking the
 * database "what can I do next" would mean a view whose only purpose is to feed
 * a button, and a stale answer is just as wrong as a stale button.
 */

/**
 * The statuses a forward transition may target.
 *
 * `update_order_status` refuses `cancelled` and `returned` outright and routes
 * them to `cancel_order`, and the TypeScript wrapper says the same. Naming the
 * exclusion here keeps the UI from being able to ask for something the
 * function will never accept.
 */
export type ForwardStatus = Exclude<OrderStatus, "cancelled" | "returned">;

const NEXT: Partial<Record<OrderStatus, ForwardStatus>> = {
  pending: "confirmed",
  confirmed: "packed",
  packed: "shipped",
  shipped: "delivered",
  delivered: "completed",
};

/** Verbs, so the forward button reads as an action rather than as a state. */
const ACTION_LABELS: Record<string, string> = {
  confirmed: "Confirm order",
  packed: "Mark packed",
  shipped: "Mark shipped",
  delivered: "Mark delivered",
  completed: "Complete",
};

export function nextStatus(status: OrderStatus): ForwardStatus | null {
  return NEXT[status] ?? null;
}

export function nextStatusLabel(status: OrderStatus): string | null {
  const next = nextStatus(status);
  return next ? (ACTION_LABELS[next] ?? `Move to ${next}`) : null;
}

/**
 * Whether to offer Cancel.
 *
 * Mirrors `cancel_order`'s eligibility: anything not yet shipped, plus a
 * completed in-person sale inside the reversal window.
 *
 * The reversal window is deliberately NOT evaluated here. The server compares
 * the order's own timestamp against the configured window, and a client-side
 * clock or a cached settings value would give the wrong answer. So a sale past
 * its window still shows the button and is refused on click, with the server's
 * own message — which is more honest than hiding a button and leaving the admin
 * unsure whether the action is possible.
 */
export function canCancel(status: OrderStatus, channel: string): boolean {
  if (status === "pending" || status === "confirmed" || status === "packed") return true;
  return status === "completed" && channel === "in_person";
}

/** Past the point where cancelling would need a return rather than a cancel. */
export function isFulfilmentLocked(status: OrderStatus): boolean {
  return (
    status === "shipped" || status === "delivered" || status === "cancelled" || status === "returned"
  );
}

export const advanceOrderSchema = z.object({
  orderId: z.string().uuid(),
  newStatus: z.enum([
    "pending",
    "confirmed",
    "packed",
    "shipped",
    "delivered",
    "completed",
  ] as [ForwardStatus, ...ForwardStatus[]]),
  note: z.string().trim().max(500).optional(),
  courier: z.string().trim().max(120).optional(),
  tracking: z.string().trim().max(120).optional(),
});

export const cancelOrderSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().min(3, "Give a short reason — it goes on the order's history.").max(300),
  restock: z.boolean().default(true),
  refund: z.boolean().default(true),
});

/**
 * Restocking an order that was cancelled without restocking.
 *
 * Only the order id: there is nothing to choose. The quantity is the order's own
 * line quantities summed per product, computed in the RPC, so an admin cannot
 * type a number that disagrees with what was sold — which is exactly the manual
 * `adjust_stock` recovery this replaces.
 */
export const restockCancelledSchema = z.object({
  orderId: z.string().uuid(),
});

/**
 * Whether an order can still have its stock returned.
 *
 * Cancellation is the only path to a cancelled order, and the RPC is the
 * authority — but a `cancelled` order that was cancelled WITH restocking has
 * nothing left to do, and offering the button there would invite an admin to
 * press a button that can only ever report zero. The button is offered whenever
 * the order is cancelled; the RPC answers the rest, and a repeat is a clean
 * no-op rather than an error.
 */
export function canRestockCancelled(status: OrderStatus): boolean {
  return status === "cancelled";
}

export type AdvanceOrderInput = z.infer<typeof advanceOrderSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
export type RestockCancelledInput = z.infer<typeof restockCancelledSchema>;
