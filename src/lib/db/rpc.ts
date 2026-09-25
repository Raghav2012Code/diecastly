import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type Result } from "./errors";
import type { ManualMovementType } from "@/lib/types/database.types";

/**
 * The only place the stock RPC names and argument shapes are declared. Stock is
 * mutated exclusively through these security-definer functions; nothing here
 * writes to `inventory_stock` or `inventory_movements` directly.
 */

export type StockMutationResult = {
  product_id: string;
  quantity: number;
  movement_id: string;
  idempotent?: boolean;
  already_initialized?: boolean;
};

type Client = SupabaseClient;

export async function setInitialStock(
  client: Client,
  args: { productId: string; quantity: number; unitCost?: number | null },
): Promise<Result<StockMutationResult>> {
  const { data, error } = await client.rpc("set_initial_stock", {
    p_product_id: args.productId,
    p_quantity: args.quantity,
    p_unit_cost: args.unitCost ?? null,
  });
  if (error) return fail(error);
  return ok(data as StockMutationResult);
}

export async function restockProduct(
  client: Client,
  args: {
    productId: string;
    quantity: number;
    unitCost?: number | null;
    setCurrentCost?: boolean;
    note?: string | null;
    idempotencyKey?: string | null;
  },
): Promise<Result<StockMutationResult>> {
  const { data, error } = await client.rpc("restock_product", {
    p_product_id: args.productId,
    p_quantity: args.quantity,
    p_unit_cost: args.unitCost ?? null,
    p_set_current_cost: args.setCurrentCost ?? false,
    p_note: args.note ?? null,
    p_idempotency_key: args.idempotencyKey ?? null,
  });
  if (error) return fail(error);
  return ok(data as StockMutationResult);
}

export async function adjustStock(
  client: Client,
  args: {
    productId: string;
    delta: number;
    reason: ManualMovementType;
    note?: string | null;
    idempotencyKey?: string | null;
  },
): Promise<Result<StockMutationResult>> {
  const { data, error } = await client.rpc("adjust_stock", {
    p_product_id: args.productId,
    p_delta: args.delta,
    p_reason: args.reason,
    p_note: args.note ?? null,
    p_idempotency_key: args.idempotencyKey ?? null,
  });
  if (error) return fail(error);
  return ok(data as StockMutationResult);
}
