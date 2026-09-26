import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/lib/db/errors";
import type {
  CustomerRow,
  VCustomerSummaryRow,
  VOrderSummaryRow,
} from "@/lib/types/database.types";

/**
 * Customer reads. Customers are created and updated at checkout by the sale
 * RPC (normalized phone is the linking key); this module only reads them, so
 * the till can attach an existing buyer to a sale.
 */

function sanitizeSearch(term: string): string {
  return term
    .trim()
    .replace(/[,()*%\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchCustomers(term: string, limit = 8): Promise<Result<CustomerRow[]>> {
  const supabase = await createClient();
  const capped = Math.min(25, Math.max(1, Math.trunc(limit)));
  const cleaned = sanitizeSearch(term);

  let query = supabase
    .from("customers")
    .select("*")
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
// Read-only. The storefront links to a customer record but never modifies one
// (D51), so there is deliberately no edit path in this module.
// ---------------------------------------------------------------------------

const CUSTOMER_PAGE_SIZE = 25;
const CUSTOMER_MAX_PAGE_SIZE = 100;

export type CustomerListParams = {
  search?: string;
  page?: number;
  pageSize?: number;
};

export type CustomerListPage = {
  rows: VCustomerSummaryRow[];
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

  const term = params.search ? sanitizeSearch(params.search) : "";
  if (term) {
    query = query.or(`name.ilike.%${term}%,phone_normalized.ilike.%${term}%,email.ilike.%${term}%`);
  }

  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) return fail(error);

  return ok({ rows: (data ?? []) as VCustomerSummaryRow[], total: count ?? 0, page, pageSize });
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
