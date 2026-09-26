"use server";

import { z } from "zod";
import { getPublicProductsByIds } from "@/lib/store/data";
import type { CartLineLive } from "@/lib/store/cart";

/**
 * Live catalog data for the ids currently in a cart.
 *
 * The cart is client-side and non-authoritative, so the pages that show it have
 * no way to know on the server which products are in it — localStorage is not
 * readable from a server component. This is the bridge: the client sends the ids
 * it holds, and the server answers with what the catalog currently says.
 *
 * Only ids are accepted. Nothing here can set a price or a quantity, and the
 * response is exactly the live row — so a compromised or stale client learns
 * nothing it could not read from the public catalog anyway.
 */

const idsSchema = z.array(z.string().uuid()).max(50);

export type CartLiveResult =
  | { ok: true; live: CartLineLive[] }
  | { ok: false; error: string };

export async function loadCartLiveAction(input: unknown): Promise<CartLiveResult> {
  const parsed = idsSchema.safeParse(input);
  // A malformed id list is treated as an empty cart rather than an error: the
  // cart is rebuilt from the response either way, and refusing would leave the
  // shopper looking at a page that cannot explain itself.
  if (!parsed.success) return { ok: true, live: [] };

  const rows = await getPublicProductsByIds(parsed.data);
  if (!rows.ok) return { ok: false, error: rows.error.message };

  return {
    ok: true,
    live: rows.data.map((row) => ({
      productId: row.id,
      name: row.name,
      unitPrice: row.selling_price,
      available: row.quantity,
    })),
  };
}
