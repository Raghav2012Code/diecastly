import { createClient } from "@/lib/supabase/server";
import { sanitizeSearchTerm as sanitizeSearch } from "@/lib/search";
import { fail, ok, type Result } from "@/lib/db/errors";
import type { CustomerInput } from "@/lib/validation/customers";
import type {
  CustomerRow,
  VCustomerSummaryRow,
  VOrderSummaryRow,
} from "@/lib/types/database.types";

/**
 * Customers data module. Reads use `v_customer_summary` for derived metrics;
 * metadata writes go straight through RLS (`customers_admin_all`) exactly as
 * the catalog module writes products and suppliers. Customers are the metadata
 * lane, not a ledger: no stock, order or payment row is ever written here.
 * Orders are read from `v_order_summary` and never mutated.
 */

/**
 * `v_customer_summary` plus the archive flag the view exposes. The generated
 * `VCustomerSummaryRow` predates `is_active`, so the extension is declared
 * locally rather than reaching into the generated types.
 */
export type CustomerSummaryRow = VCustomerSummaryRow & { is_active: boolean };

/** A full customer row plus the archive flag, for the detail page and edit form. */
export type CustomerDetailRow = CustomerRow & { is_active: boolean };

export async function searchCustomers(term: string, limit = 8): Promise<Result<CustomerRow[]>> {
  const supabase = await createClient();
  const capped = Math.min(25, Math.max(1, Math.trunc(limit)));
  const cleaned = sanitizeSearch(term);

  let query = supabase
    .from("customers")
    .select("*")
    // Archived customers are retired from the till: attaching a new sale to one
    // would silently resurrect a record the admin deliberately put away.
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(capped);

  if (cleaned) {
    query = query.or(
      `name.ilike.%${cleaned}%,phone_normalized.ilike.%${cleaned}%,email.ilike.%${cleaned}%`,
    );
  }

  const { data, error } = await query;
  if (error) return fail(error);
  return ok((data ?? []) as CustomerRow[]);
}

// ---------------------------------------------------------------------------
// Customer list
//
// `v_customer_summary` is the only source, rather than reading `customers` and
// counting orders here. The view already does the count and the spend, and —
// importantly — it does the spend EXCLUDING cancelled and returned orders.
// Recomputing that here would mean repeating the rule, and repeating it wrong is
// how a cancelled order ends up counted as lifetime value in a customer list.
//
// The storefront links to a customer record but never modifies one (D51); the
// writes below are the admin metadata lane, added for Phase 6.
// ---------------------------------------------------------------------------

const CUSTOMER_PAGE_SIZE = 25;
const CUSTOMER_MAX_PAGE_SIZE = 100;

export type CustomerListParams = {
  search?: string;
  /** Include archived customers. Off by default, like the supplier list. */
  includeArchived?: boolean;
  page?: number;
  pageSize?: number;
};

export type CustomerListPage = {
  rows: CustomerSummaryRow[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listCustomers(
  params: CustomerListParams = {},
): Promise<Result<CustomerListPage>> {
  const supabase = await createClient();
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = Math.min(
    CUSTOMER_MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(params.pageSize ?? CUSTOMER_PAGE_SIZE)),
  );
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("v_customer_summary")
    .select("*", { count: "exact" })
    // Most recently active first: the customer most likely to be ringing is the
    // one who ordered most recently, not the one with the highest lifetime spend.
    .order("last_order_at", { ascending: false, nullsFirst: false })
    .order("customer_id", { ascending: true });

  if (!params.includeArchived) query = query.eq("is_active", true);

  const term = params.search ? sanitizeSearch(params.search) : "";
  if (term) {
    query = query.or(`name.ilike.%${term}%,phone_normalized.ilike.%${term}%,email.ilike.%${term}%`);
  }

  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) return fail(error);

  return ok({ rows: (data ?? []) as CustomerSummaryRow[], total: count ?? 0, page, pageSize });
}

// ---------------------------------------------------------------------------
// Customer metadata writes
//
// Direct RLS-guarded table writes, the metadata lane the architecture reserves
// for `customers` (`customers_admin_all`). Nothing here touches stock, orders or
// payments. There is no hard delete: a customer is archived via `is_active`,
// exactly as a supplier is deactivated, so order history keeps its link.
// ---------------------------------------------------------------------------

function customerColumns(input: CustomerInput) {
  return {
    name: input.name,
    phone_normalized: input.phone,
    email: input.email,
    address_line1: input.addressLine1,
    address_line2: input.addressLine2,
    city: input.city,
    state: input.state,
    postal_code: input.postalCode,
    country: input.country,
    notes: input.notes,
    is_active: input.isActive,
  };
}

/**
 * A phone collision is the one unique-violation a customer write can produce.
 *
 * There is no variant to generate the way `uniqueSlug` can, because the
 * normalised phone IS the customer's identity — two rows for the same number is
 * the bug, not the fix. So the collision is surfaced as a remedy (edit the
 * existing customer) instead of being retried. Other 23505s fall through to the
 * generic translation, so this never masks an unrelated unique violation.
 */
function phoneConflict(error: unknown): { ok: false; error: { message: string; field?: string } } | null {
  const candidate = error as { code?: string | null; message?: string | null; details?: string | null } | null;
  if (candidate?.code !== "23505") return null;
  const text = `${candidate.message ?? ""} ${candidate.details ?? ""}`;
  if (!text.includes("phone_normalized")) return null;
  return {
    ok: false,
    error: {
      message: "A customer with that phone number already exists. Edit that customer instead.",
      field: "phone",
    },
  };
}

export async function createCustomer(input: CustomerInput): Promise<Result<CustomerRow>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .insert(customerColumns(input))
    .select("*")
    .single();
  if (error) return phoneConflict(error) ?? fail(error);
  return ok(data as CustomerRow);
}

export async function updateCustomer(id: string, input: CustomerInput): Promise<Result<CustomerRow>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .update(customerColumns(input))
    .eq("id", id)
    .select("*")
    .single();
  if (error) return phoneConflict(error) ?? fail(error);
  return ok(data as CustomerRow);
}

/**
 * Archive or restore. Never a delete: `orders.customer_id` references the row,
 * and the order snapshots that carry the customer's name and phone at write
 * time must keep resolving to the same record.
 */
export async function setCustomerActive(id: string, isActive: boolean): Promise<Result<CustomerRow>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .update({ is_active: isActive })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return fail(error);
  return ok(data as CustomerRow);
}

// ---------------------------------------------------------------------------
// Customer detail
// ---------------------------------------------------------------------------

export async function getCustomer(id: string): Promise<Result<CustomerDetailRow | null>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (error) return fail(error);
  return ok((data as CustomerDetailRow | null) ?? null);
}

/**
 * The orders that reference this customer, newest first. Read-only: orders are a
 * ledger and this module never writes them (rule 1).
 */
export async function listCustomerOrders(customerId: string): Promise<Result<VOrderSummaryRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_order_summary")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) return fail(error);
  return ok((data ?? []) as VOrderSummaryRow[]);
}

/**
 * The unfulfilled orders themselves, oldest first.
 *
 * This is the actionable slice of the order queue and the reason it exists
 * separately from the filtered list: someone who needs chasing is not the
 * customer with the most orders, and finding them by sorting a list is work an
 * admin should not do by hand every morning.
 */
export async function listOpenOrders(): Promise<Result<VOrderSummaryRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_order_summary")
    .select("*")
    .in("status", ["pending", "confirmed", "packed"])
    // Oldest first, deliberately: a pending order from this morning and one
    // from last week are both "pending", and only the age distinguishes them.
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) return fail(error);
  return ok((data ?? []) as VOrderSummaryRow[]);
}
