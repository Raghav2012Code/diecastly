import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/lib/db/errors";
import type { CustomerRow } from "@/lib/types/database.types";

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
