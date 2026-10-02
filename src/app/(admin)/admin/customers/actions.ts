"use server";

import { revalidatePath } from "next/cache";
import { fromFriendly, fromZod, type ActionResult } from "@/lib/action-result";
import * as customers from "@/lib/customers/data";
import {
  customerArchiveSchema,
  customerCreateSchema,
  customerIdSchema,
  customerUpdateSchema,
} from "@/lib/validation/customers";

/**
 * Customer metadata server actions.
 *
 * Customers are the RLS metadata lane: the writes go through the data module to
 * `customers` directly, never through an RPC, and never touch orders or
 * payments. There is no delete action — archiving is `set_customer_active`.
 */

function revalidateCustomers(customerId?: string) {
  revalidatePath("/admin/customers");
  if (customerId) revalidatePath(`/admin/customers/${customerId}`);
  // The POS customer picker reads the same rows and must stop offering an
  // archived customer immediately.
  revalidatePath("/admin/pos");
}

export async function createCustomerAction(
  input: unknown,
): Promise<ActionResult<{ customerId: string }>> {
  const parsed = customerCreateSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const created = await customers.createCustomer(parsed.data);
  if (!created.ok) return fromFriendly(created.error);

  revalidateCustomers(created.data.id);
  return { ok: true, data: { customerId: created.data.id } };
}

export async function updateCustomerAction(id: string, input: unknown): Promise<ActionResult<null>> {
  const idParsed = customerIdSchema.safeParse(id);
  if (!idParsed.success) return fromZod(idParsed.error);

  const parsed = customerUpdateSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const updated = await customers.updateCustomer(idParsed.data, parsed.data);
  if (!updated.ok) return fromFriendly(updated.error);

  revalidateCustomers(idParsed.data);
  return { ok: true, data: null };
}

export async function setCustomerActiveAction(input: unknown): Promise<ActionResult<null>> {
  const parsed = customerArchiveSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const updated = await customers.setCustomerActive(parsed.data.customerId, parsed.data.isActive);
  if (!updated.ok) return fromFriendly(updated.error);

  revalidateCustomers(parsed.data.customerId);
  return { ok: true, data: null };
}
