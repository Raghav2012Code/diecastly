"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fromFriendly, fromZod, type ActionResult } from "@/lib/action-result";
import { adjustStock, restockProduct, setInitialStock } from "@/lib/db/rpc";
import * as catalog from "@/lib/catalog/data";
import { getProductMovements } from "@/lib/inventory/data";
import {
  adjustDelta,
  adjustSchema,
  initialStockSchema,
  restockSchema,
  thresholdSchema,
} from "@/lib/validation/inventory";

/**
 * Inventory server actions. Every stock change goes through the atomic RPCs —
 * there are no direct writes to inventory_stock or inventory_movements.
 */

function revalidateInventory() {
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/movements");
  revalidatePath("/admin/products");
}

export type StockResult = { quantity: number };

export async function restockAction(input: unknown): Promise<ActionResult<StockResult>> {
  const parsed = restockSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const supabase = await createClient();
  const result = await restockProduct(supabase, {
    productId: parsed.data.productId,
    quantity: parsed.data.quantity,
    unitCost: parsed.data.unitCost,
    setCurrentCost: parsed.data.setCurrentCost,
    note: parsed.data.note,
    idempotencyKey: parsed.data.idempotencyKey,
  });
  if (!result.ok) return fromFriendly(result.error);

  revalidateInventory();
  return { ok: true, data: { quantity: result.data.quantity } };
}

export async function adjustAction(input: unknown): Promise<ActionResult<StockResult>> {
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const supabase = await createClient();
  const result = await adjustStock(supabase, {
    productId: parsed.data.productId,
    delta: adjustDelta(parsed.data),
    reason: parsed.data.reason,
    note: parsed.data.note,
    idempotencyKey: parsed.data.idempotencyKey,
  });
  if (!result.ok) return fromFriendly(result.error);

  revalidateInventory();
  return { ok: true, data: { quantity: result.data.quantity } };
}

export async function setInitialStockAction(input: unknown): Promise<ActionResult<StockResult>> {
  const parsed = initialStockSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const supabase = await createClient();
  const result = await setInitialStock(supabase, {
    productId: parsed.data.productId,
    quantity: parsed.data.quantity,
    unitCost: parsed.data.unitCost,
  });
  if (!result.ok) return fromFriendly(result.error);

  revalidateInventory();
  return { ok: true, data: { quantity: result.data.quantity } };
}

export async function updateThresholdAction(input: unknown): Promise<ActionResult<null>> {
  const parsed = thresholdSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const result = await catalog.updateProductThreshold(
    parsed.data.productId,
    parsed.data.lowStockThreshold,
  );
  if (!result.ok) return fromFriendly(result.error);

  revalidatePath("/admin/inventory");
  revalidatePath("/admin/products");
  return { ok: true, data: null };
}

const uuidSchema = z.string().uuid();

export async function productMovementsAction(
  productId: string,
  limit = 50,
): Promise<ActionResult<unknown>> {
  const parsed = uuidSchema.safeParse(productId);
  if (!parsed.success) return fromZod(parsed.error);

  const result = await getProductMovements(parsed.data, limit);
  if (!result.ok) return fromFriendly(result.error);
  return { ok: true, data: result.data };
}
