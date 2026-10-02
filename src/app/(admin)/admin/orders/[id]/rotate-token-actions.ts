"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rotateOrderAccessToken } from "@/lib/db/rpc";
import { fromFriendly, fromZod, type ActionResult } from "@/lib/action-result";

/**
 * Rotating an order's guest access link.
 *
 * Kept in its own file rather than added to `orders/actions.ts` so the token
 * path — the one place a bearer secret crosses back to the interface — stays
 * visibly separate from the payment and fulfilment actions.
 */

const rotateTokenSchema = z.object({ orderId: z.string().uuid() });

export type RotatedAccessToken = {
  orderNumber: string;
  accessToken: string;
};

export async function rotateOrderAccessTokenAction(
  input: unknown,
): Promise<ActionResult<RotatedAccessToken>> {
  const parsed = rotateTokenSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const supabase = await createClient();
  const result = await rotateOrderAccessToken(supabase, { orderId: parsed.data.orderId });
  if (!result.ok) return fromFriendly(result.error);

  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  revalidatePath("/admin/orders");

  return {
    ok: true,
    data: {
      orderNumber: result.data.order_number,
      accessToken: result.data.access_token,
    },
  };
}
