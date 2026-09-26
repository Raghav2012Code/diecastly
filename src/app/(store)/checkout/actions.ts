"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ZodError } from "zod";
import { createAnonClient } from "@/lib/supabase/server";
import { placeOnlineOrder } from "@/lib/db/rpc";
import { fromZod } from "@/lib/action-result";
import { GENERIC_ERROR_MESSAGE } from "@/lib/db/errors";
import { getPublicProductsByIds } from "@/lib/store/data";
import { compareCart, type CartLineLive } from "@/lib/store/cart";
import type { CartDrift } from "@/lib/store/cart";

/**
 * Guest checkout.
 *
 * The cart is non-authoritative, so nothing the client sends about price or
 * stock is believed. The order is placed in three beats:
 *
 *   1. Validate the shopper's own details.
 *   2. Re-read the live catalog and compare it with the cart's snapshot.
 *   3. Only then call `place_online_order`.
 *
 * Step 2 is the one that matters. A shopper can sit on a checkout page for a
 * while, and in that time a price can move or stock can run out. Silently
 * charging the new price would be wrong, and letting the server reject the order
 * at the last moment would lose the whole basket over one line — so stock
 * problems are corrected and reported, and a price change is put back to the
 * shopper to agree to.
 *
 * The order itself is created only by `place_online_order`, which is
 * `security definer` and granted to `anon`. Nothing here writes an order, an
 * order line, a payment or a stock row.
 */

const checkoutSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  phone: z.string().trim().min(6, "Enter a phone number we can reach you on.").max(20),
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),
  addressLine1: z.string().trim().min(1, "Enter your address.").max(200),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, "Enter your city.").max(100),
  state: z.string().trim().min(1, "Enter your state.").max(100),
  postalCode: z.string().trim().min(3, "Enter your postal code.").max(12),
  paymentMethod: z.enum(["upi", "cod"]),
  notes: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().min(8).max(100),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive().max(99),
        // The snapshot, used only to detect that the price moved. It is never
        // sent onward: place_online_order reads the catalog price itself,
        // because the caller is anonymous and has no authority to set one.
        snapshotPrice: z.number().nonnegative(),
      }),
    )
    .min(1, "Your cart is empty."),
});

/**
 * `fromZod` returns the full `ActionResult` union even though it only ever
 * constructs the failure branch, so its fields have to be narrowed before they
 * can be read. Doing that inline made the success path look unreachable to
 * TypeScript, so the narrow lives here.
 */
function zodFailure(error: ZodError): { message: string; field?: string } {
  const mapped = fromZod(error);
  return mapped.ok ? { message: GENERIC_ERROR_MESSAGE } : { message: mapped.error, field: mapped.field };
}

export type CheckoutResult =
  | { status: "placed"; orderNumber: string; accessToken: string }
  | { status: "needs-attention"; message: string; drift: CartDrift }
  | { status: "failed"; message: string; field?: string };

export async function placeOrderAction(input: unknown): Promise<CheckoutResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    const { message, field } = zodFailure(parsed.error);
    return { status: "failed", message, field };
  }

  const { items, paymentMethod, idempotencyKey, ...customer } = parsed.data;

  // --- 2. re-validate against the live catalog ------------------------------
  const rows = await getPublicProductsByIds(items.map((item) => item.productId));
  if (!rows.ok) {
    return { status: "failed", message: "We could not check your items. Please try again." };
  }

  const liveById = new Map<string, CartLineLive>(
    rows.data.map((row) => [
      row.id,
      { productId: row.id, name: row.name, unitPrice: row.selling_price, available: row.quantity },
    ]),
  );

  const drift = compareCart(
    items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      name: liveById.get(item.productId)?.name ?? "Item",
      unitPrice: item.snapshotPrice,
      imagePath: null,
      slug: null,
      available: item.quantity,
    })),
    liveById,
  );

  if (!drift.clean) {
    // Stock problems are corrected in the browser by `applyStockDrift`, and the
    // shopper is told what happened. A price change is never corrected for them.
    return { status: "needs-attention", message: driftMessage(drift), drift };
  }

  // --- 3. place the order ---------------------------------------------------
  const supabase = createAnonClient();
  const placed = await placeOnlineOrder(supabase, {
    items: items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    customer: {
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      addressLine1: customer.addressLine1,
      addressLine2: customer.addressLine2,
      city: customer.city,
      state: customer.state,
      postalCode: customer.postalCode,
    },
    paymentMethod,
    idempotencyKey,
    notes: customer.notes,
  });

  if (!placed.ok) {
    // `placed.error.message` is already a mapped, friendly string — a raw
    // SQLSTATE never reaches the shopper.
    return { status: "failed", message: placed.error.message };
  }

  const { order_number, access_token } = placed.data;

  // Cleared by the client on arrival at the confirmation page, not here: the cart
  // is browser state and this runs on the server.
  redirect(`/order/${encodeURIComponent(order_number)}?token=${encodeURIComponent(access_token)}`);
}

function driftMessage(drift: CartDrift): string {
  const parts: string[] = [];

  if (drift.removals.length > 0) {
    parts.push(
      drift.removals.length === 1
        ? `${drift.removals[0].name} is no longer available and was removed.`
        : `${drift.removals.length} items are no longer available and were removed.`,
    );
  }
  if (drift.reductions.length > 0) {
    parts.push(
      drift.reductions.length === 1
        ? `Only ${drift.reductions[0].quantity} of ${drift.reductions[0].name} left.`
        : `${drift.reductions.length} quantities were reduced to what is in stock.`,
    );
  }
  if (drift.priceChanges.length > 0) {
    parts.push("A price changed. Please review it before placing the order.");
  }

  return parts.join(" ");
}
