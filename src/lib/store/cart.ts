import { z } from "zod";
import { addMoney, multiplyMoney, roundMoney } from "@/lib/validation/money";

/**
 * The cart's line model.
 *
 * The cart is client-side and explicitly NON-AUTHORITATIVE (ux.md §10). It stores
 * a product id, a quantity and a display snapshot, and nothing else is trusted:
 * price and stock are re-read from the database at checkout, and the snapshot
 * exists only so the shopper can be told when the live price has moved.
 *
 * Every money value here is a rupee amount and every total goes through
 * `money.ts`. Hand-rolled `*` or `+` on a price is a defect, and the cart is the
 * one place a storefront adds up numbers the server never sees.
 */

export const MAX_LINE_QUANTITY = 99;

/** A line as persisted in localStorage. */
export const cartLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(MAX_LINE_QUANTITY),
  // The snapshot. Never sent as authority: place_online_order ignores any price
  // because the caller is anonymous and the catalog price is the only price it
  // may be given. These exist to detect a change, nothing more.
  name: z.string().min(1).max(200),
  unitPrice: z.number().nonnegative(),
  imagePath: z.string().max(400).nullable().optional(),
  slug: z.string().max(200).nullable().optional(),
  /** Availability as last seen, used to cap the quantity control. */
  available: z.number().int().nonnegative(),
});

export type CartLine = z.infer<typeof cartLineSchema>;

/**
 * The cart as read back from localStorage.
 *
 * Parsed rather than cast, because localStorage is user-writable and survives
 * across deploys. A hand-edited or stale-shaped value must be dropped, not
 * trusted — a cast here would let a crafted cart carry a negative quantity or a
 * non-uuid product id straight into checkout.
 */
export function parseCart(raw: string | null): CartLine[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const lines: CartLine[] = [];
  for (const candidate of parsed) {
    const result = cartLineSchema.safeParse(candidate);
    // Individually dropped rather than rejecting the whole cart: one corrupt
    // line should not cost the shopper the rest of their basket.
    if (result.success) lines.push(result.data);
  }
  return lines;
}

/**
 * Adds a line, or increments an existing one for the same product.
 *
 * The quantity is capped at what is available as well as at MAX_LINE_QUANTITY, so
 * a shopper cannot build a line the database will refuse. The cap is applied to
 * the *combined* quantity, not the incoming one — adding 2 to a line that is
 * already at the cap leaves it at the cap rather than doubling past it.
 *
 * The incoming snapshot wins, because it is the fresher of the two: a shopper who
 * opens the product page again sees the current price and image.
 */
export function addLine(
  lines: CartLine[],
  incoming: CartLine,
): { lines: CartLine[]; capped: boolean } {
  const cap = quantityCap(incoming.available);
  const wanted = Math.min(incoming.quantity, cap);
  const existing = lines.find((line) => line.productId === incoming.productId);

  if (!existing) {
    return {
      lines: [...lines, { ...incoming, quantity: wanted }],
      capped: wanted < incoming.quantity,
    };
  }

  const combined = existing.quantity + wanted;
  const applied = Math.min(combined, cap);
  return {
    lines: lines.map((line) =>
      line.productId === incoming.productId
        ? { ...incoming, quantity: applied }
        : line,
    ),
    capped: applied < combined,
  };
}

/** The largest quantity selectable for a line, never below 1 for a sellable product. */
export function quantityCap(available: number): number {
  if (!Number.isFinite(available) || available <= 0) return 0;
  return Math.min(MAX_LINE_QUANTITY, Math.trunc(available));
}

/** Sets a line's quantity, clamped to its cap. A non-positive value removes the line. */
export function setLineQuantity(
  lines: CartLine[],
  productId: string,
  quantity: number,
): CartLine[] {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return lines.filter((line) => line.productId !== productId);
  }
  return lines.map((line) =>
    line.productId === productId
      ? { ...line, quantity: Math.min(Math.trunc(quantity), quantityCap(line.available)) }
      : line,
  );
}

export function removeLine(lines: CartLine[], productId: string): CartLine[] {
  return lines.filter((line) => line.productId !== productId);
}

/** The cart's subtotal: money arithmetic, one rounded total rather than per-line rounding. */
export function cartSubtotal(lines: CartLine[]): number {
  return addMoney(...lines.map((line) => multiplyMoney(line.unitPrice, line.quantity)));
}

/** The number of physical units, which is not the same as the number of lines. */
export function cartCount(lines: CartLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}

/**
 * Order total, including shipping.
 *
 * The shipping fee comes from `v_public_settings.default_shipping_fee` and is
 * passed in rather than read here, because this module is pure and the same
 * function is used by the checkout summary and the cart page. The server
 * recomputes the total itself in `place_online_order`; this is only ever a
 * display, which is why the checkout re-validates before charging.
 */
export function cartTotal(lines: CartLine[], shippingFee: number): number {
  return addMoney(cartSubtotal(lines), roundMoney(shippingFee));
}

/** How a cart line compares with the live catalog. */
export type LineDrift =
  | { kind: "ok" }
  | { kind: "removed" }
  | { kind: "price"; was: number; now: number }
  | { kind: "reduced"; available: number }
  | { kind: "unavailable" };

export type CartLineLive = {
  productId: string;
  name: string;
  unitPrice: number;
  available: number;
};

/**
 * Compares one cart line with the live catalog.
 *
 * A price change is reported separately from a stock change because they need
 * different responses: a price change is the shopper's decision (ux.md §10 says
 * surface a clear notice), while a stock change has no choice — the line is
 * reduced or dropped, because `place_online_order` would reject the order
 * outright and the shopper would lose the whole basket over one line.
 *
 * Price is compared after rounding, so a float representation artefact is not
 * reported to the shopper as a price change.
 */
export function compareLine(line: CartLine, live: CartLineLive | undefined): LineDrift {
  if (!live) return { kind: "removed" };

  if (line.quantity > live.available) {
    return live.available === 0
      ? { kind: "unavailable" }
      : { kind: "reduced", available: live.available };
  }

  if (roundMoney(line.unitPrice) !== roundMoney(live.unitPrice)) {
    return { kind: "price", was: line.unitPrice, now: live.unitPrice };
  }

  return { kind: "ok" };
}

/** Everything the cart page and checkout need to tell the shopper what changed. */
export type CartDrift = {
  /** Lines whose price moved, with both figures. */
  priceChanges: { productId: string; name: string; was: number; now: number }[];
  /** Lines to reduce to a smaller quantity, with the new quantity. */
  reductions: { productId: string; name: string; quantity: number }[];
  /** Lines to drop entirely. */
  removals: { productId: string; name: string }[];
  /** True when nothing changed, so the UI can skip the notice. */
  clean: boolean;
};

export function compareCart(
  lines: CartLine[],
  liveById: Map<string, CartLineLive>,
): CartDrift {
  const priceChanges: CartDrift["priceChanges"] = [];
  const reductions: CartDrift["reductions"] = [];
  const removals: CartDrift["removals"] = [];

  for (const line of lines) {
    const drift = compareLine(line, liveById.get(line.productId));
    switch (drift.kind) {
      case "price":
        priceChanges.push({
          productId: line.productId,
          name: liveById.get(line.productId)?.name ?? line.name,
          was: drift.was,
          now: drift.now,
        });
        break;
      case "reduced":
        reductions.push({
          productId: line.productId,
          name: liveById.get(line.productId)?.name ?? line.name,
          quantity: drift.available,
        });
        break;
      case "unavailable":
      case "removed":
        removals.push({ productId: line.productId, name: line.name });
        break;
      case "ok":
        break;
    }
  }

  return {
    priceChanges,
    reductions,
    removals,
    clean: priceChanges.length === 0 && reductions.length === 0 && removals.length === 0,
  };
}

/**
 * Applies the reductions and removals from a drift report, leaving price changes
 * alone.
 *
 * Deliberately one-directional: stock facts are not the shopper's to overrule,
 * so they are applied, while a price change is a decision they have to make. A
 * line whose price rose is also capped to the new price on the resulting cart by
 * the caller refreshing the snapshot.
 */
export function applyStockDrift(lines: CartLine[], drift: CartDrift): CartLine[] {
  let next = lines;
  for (const removal of drift.removals) {
    next = removeLine(next, removal.productId);
  }
  for (const reduction of drift.reductions) {
    next = setLineQuantity(next, reduction.productId, reduction.quantity);
  }
  return next;
}

/**
 * Rewrites the snapshot from the live catalog, so a line showing an old price
 * shows the new one. Only safe to call once the shopper has agreed to it.
 */
export function refreshSnapshots(lines: CartLine[], liveById: Map<string, CartLineLive>): CartLine[] {
  return lines
    .filter((line) => liveById.has(line.productId))
    .map((line) => {
      const live = liveById.get(line.productId)!;
      return {
        ...line,
        name: live.name,
        unitPrice: live.unitPrice,
        available: live.available,
        quantity: Math.min(line.quantity, quantityCap(live.available)),
      };
    });
}
