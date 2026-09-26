import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/lib/db/errors";
import type {
  DerivedPaymentStatus,
  OrderChannel,
  OrderDetail,
  OrderItemRow,
  OrderReceipt,
  OrderRow,
  OrderStatus,
  OrderStatusHistoryRow,
  PaymentRow,
  SettingsRow,
  VOrderFinancialsRow,
  VOrderSummaryRow,
} from "@/lib/types/database.types";

/**
 * Orders data module: order list/detail reads, the append-only payments ledger,
 * status history, receipt data and business settings. All writes to orders,
 * order items, status history and payments go through the RPCs in
 * `lib/db/rpc.ts` — this module never writes them.
 */

export type OrderListParams = {
  search?: string;
  status?: OrderStatus | "all";
  paymentStatus?: DerivedPaymentStatus | "all";
  channel?: OrderChannel | "all";
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

export type OrderListPage = {
  rows: VOrderSummaryRow[];
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function clampPageSize(pageSize: number | undefined): number {
  if (!pageSize || Number.isNaN(pageSize)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(pageSize)));
}

function sanitizeSearch(term: string): string {
  return term
    .trim()
    .replace(/[,()*%\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** IST day boundary as a UTC instant. Reporting uses Asia/Kolkata throughout. */
function istBoundary(date: string, endOfDay: boolean): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const parsed = new Date(`${date}T${time}+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function listOrders(params: OrderListParams = {}): Promise<Result<OrderListPage>> {
  const supabase = await createClient();
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = clampPageSize(params.pageSize);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from("v_order_summary").select("*", { count: "exact" });

  if (params.status && params.status !== "all") query = query.eq("status", params.status);
  if (params.paymentStatus && params.paymentStatus !== "all") {
    query = query.eq("payment_status", params.paymentStatus);
  }
  if (params.channel && params.channel !== "all") query = query.eq("channel", params.channel);

  const term = params.search ? sanitizeSearch(params.search) : "";
  if (term) {
    query = query.or(
      `order_number.ilike.%${term}%,customer_name.ilike.%${term}%,customer_phone.ilike.%${term}%`,
    );
  }

  const fromIso = params.from ? istBoundary(params.from, false) : null;
  if (fromIso) query = query.gte("created_at", fromIso);
  const toIso = params.to ? istBoundary(params.to, true) : null;
  if (toIso) query = query.lte("created_at", toIso);

  // Newest first. There is no sort control on this list; a `sort` parameter here
  // had no caller and was dead code.
  query = query.order("created_at", { ascending: false });


  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) return fail(error);

  return ok({ rows: (data ?? []) as VOrderSummaryRow[], total: count ?? 0, page, pageSize });
}

export async function getOrderDetail(orderId: string): Promise<Result<OrderDetail | null>> {
  const supabase = await createClient();

  const [orderResult, financialsResult, itemsResult, paymentsResult, historyResult] = await Promise.all([
    supabase.from("orders").select("*").eq("id", orderId).maybeSingle(),
    supabase.from("v_order_financials").select("*").eq("order_id", orderId).maybeSingle(),
    supabase
      .from("order_items")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    supabase
      .from("payments")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    supabase
      .from("order_status_history")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
  ]);

  if (orderResult.error) return fail(orderResult.error);
  const order = orderResult.data as OrderRow | null;
  if (!order) return ok(null);

  if (financialsResult.error) return fail(financialsResult.error);
  if (itemsResult.error) return fail(itemsResult.error);
  if (paymentsResult.error) return fail(paymentsResult.error);
  if (historyResult.error) return fail(historyResult.error);

  const financials = financialsResult.data as VOrderFinancialsRow | null;

  return ok({
    order,
    financials:
      financials ?? {
        order_id: order.id,
        order_number: order.order_number,
        total_due: order.total,
        total_received: 0,
        total_refunded: 0,
        net_paid: 0,
        balance: order.total,
        payment_status: "unpaid",
      },
    items: (itemsResult.data ?? []) as OrderItemRow[],
    payments: (paymentsResult.data ?? []) as PaymentRow[],
    history: (historyResult.data ?? []) as OrderStatusHistoryRow[],
  });
}

export async function getSettings(): Promise<Result<SettingsRow | null>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("*").eq("id", true).maybeSingle();
  if (error) return fail(error);
  return ok((data as SettingsRow | null) ?? null);
}

export async function getOrderReceipt(orderId: string): Promise<Result<OrderReceipt | null>> {
  const detail = await getOrderDetail(orderId);
  if (!detail.ok) return detail;
  if (!detail.data) return ok(null);

  const business = await getSettings();
  if (!business.ok) return business;

  return ok({
    order: detail.data.order,
    items: detail.data.items,
    payments: detail.data.payments,
    business: business.data,
  });
}
