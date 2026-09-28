/**
 * Reporting reads.
 *
 * Everything comes from the reporting views rather than from `orders` and
 * `order_items`, because those views already exclude cancelled and returned
 * orders and already compute profit. Recomputing any of it here would mean
 * repeating that rule in TypeScript, and the reports have to reconcile with the
 * ledger — so there is exactly one definition of "revenue", and it is in SQL.
 *
 * Money discipline: the views return `numeric(12,2)` as JavaScript numbers, and
 * this module SUMS them. Every one of those sums goes through `addMoney`, because
 * `reduce((a, b) => a + b)` over a few hundred rows accumulates binary
 * representation error, and a report that disagrees with the receipt by a paisa
 * is a report nobody trusts. There is no `*` or `+` on a money value in this file
 * that is not inside a money helper.
 *
 * Day boundaries are IST, and `v_sales_daily` has already done the conversion in
 * SQL — its `sale_date` is an IST calendar date, so it is compared as a plain
 * `YYYY-MM-DD` string rather than being re-derived here.
 */

import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/lib/db/errors";
import { addMoney, multiplyMoney, roundMoney } from "@/lib/validation/money";
import type { OrderChannel, ProductStatus } from "@/lib/types/database.types";

/**
 * Today in IST, as the `sale_date` column holds it: a plain `YYYY-MM-DD`.
 *
 * NOT `formatDateIST`, which is a DISPLAY formatter and returns "26 Sept 2026".
 * Passing that to `gte`/`lte` against a `date` column matches nothing, so every
 * figure on the dashboard would silently read as zero. `en-CA` formats as ISO,
 * which is the one locale that does.
 */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function shiftIstDate(isoDay: string, days: number): string {
  // Pure UTC calendar arithmetic on a date string. No offset is ever applied
  // here, so the result cannot be shifted by one: `shiftIstDate(d, 0) === d` for
  // every d. UTC noon rather than midnight is a defensive choice in case a local
  // conversion is ever added to this function — noon has the margin to survive
  // one — not a fix for a problem the current code has.
  const base = new Date(`${isoDay}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export type SalesRow = {
  sale_date: string;
  channel: OrderChannel;
  orders_count: number;
  units_sold: number;
  item_revenue: number;
  shipping_revenue: number;
  revenue: number;
  cogs: number;
  gross_profit: number;
  contribution_after_shipping: number;
};

export type SalesTotals = {
  ordersCount: number;
  unitsSold: number;
  itemRevenue: number;
  shippingRevenue: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  contributionAfterShipping: number;
};

/**
 * A range of days from `v_sales_daily`, already totalled.
 *
 * The view groups by (date, channel), so a range comes back as up to two rows per
 * day and has to be summed here. Every figure is rounded once, at the end, rather
 * than at each accumulation — the same rule the sale RPCs use, so a report total
 * equals the sum of the receipts that make it up.
 */
export async function getSalesTotals(
  fromDay: string,
  toDay: string,
): Promise<Result<SalesTotals>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_sales_daily")
    .select("*")
    .gte("sale_date", fromDay)
    .lte("sale_date", toDay);

  if (error) return fail(error);

  const rows = (data ?? []) as SalesRow[];

  // Units come from the same rows as every money figure, so the range applies to
  // them automatically.
  //
  // This used to sum `getProductProfit(500)`, which has no date dimension at all —
  // `v_product_profit` groups by product only — so it returned a LIFETIME unit
  // count inside a range-scoped result. The dashboard rendered it under a header
  // reading "Today", and /admin/sales printed it beneath a from/to header, with
  // nothing to reconcile the two because every other figure was range-scoped.
  //
  // D61 moved units off `v_sales_daily` because that view counted ORDERS, and
  // calling an order count "units" overstates every multi-item order by its line
  // count. The view now reports both, so the two can no longer disagree about
  // which orders are in scope. `getProductProfit` still exists for the Analytics
  // best-sellers table, which is correctly a lifetime ranking.
  return ok({
    ordersCount: rows.reduce((total, row) => total + row.orders_count, 0),
    unitsSold: rows.reduce((total, row) => total + row.units_sold, 0),
    itemRevenue: addMoney(...rows.map((row) => row.item_revenue)),
    shippingRevenue: addMoney(...rows.map((row) => row.shipping_revenue)),
    revenue: addMoney(...rows.map((row) => row.revenue)),
    cogs: addMoney(...rows.map((row) => row.cogs)),
    grossProfit: addMoney(...rows.map((row) => row.gross_profit)),
    contributionAfterShipping: addMoney(...rows.map((row) => row.contribution_after_shipping)),
  });
}

/** The daily series, for a chart or a table. One row per day, channels merged. */
export async function getSalesSeries(
  fromDay: string,
  toDay: string,
): Promise<Result<{ day: string; revenue: number; grossProfit: number; orders: number; units: number }[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_sales_daily")
    .select("*")
    .gte("sale_date", fromDay)
    .lte("sale_date", toDay)
    .order("sale_date", { ascending: true });

  if (error) return fail(error);

  // Units ride along per day so the sales CSV reconciles against the totals row
  // without the reader having to re-derive them. Integer, so it needs no rounding.
  const byDay = new Map<string, { revenue: number; grossProfit: number; orders: number; units: number }>();
  for (const row of (data ?? []) as SalesRow[]) {
    const existing = byDay.get(row.sale_date) ?? { revenue: 0, grossProfit: 0, orders: 0, units: 0 };
    byDay.set(row.sale_date, {
      // accumulate as arrays then round once, for the same reason as above
      revenue: existing.revenue + row.revenue,
      grossProfit: existing.grossProfit + row.gross_profit,
      orders: existing.orders + row.orders_count,
      units: existing.units + row.units_sold,
    });
  }

  // Rounded only here, on the way out, so a day's total is the sum of its
  // channels to the paisa rather than the sum of two rounded halves.
  return ok(
    [...byDay.entries()].map(([day, value]) => ({
      day,
      revenue: roundMoney(value.revenue),
      grossProfit: roundMoney(value.grossProfit),
      orders: value.orders,
      units: value.units,
    })),
  );
}

export type ProductProfitRow = {
  product_id: string | null;
  product_name: string;
  units_sold: number;
  item_revenue: number;
  cogs: number;
  gross_profit: number;
};

/** Hard ceiling on the best-sellers read, so a typo cannot ask for the world. */
const MAX_PRODUCT_PROFIT_ROWS = 500;

export type ProductProfitResult = {
  rows: ProductProfitRow[];
  /**
   * True when the read hit `MAX_PRODUCT_PROFIT_ROWS` and there may be more.
   *
   * This used to be silent, so the Analytics page labelled `rows.length` as
   * "Products sold" — a truncated count presented as a total — and the CSV export
   * shipped a partial file under a complete-looking filename. `listSellableProducts`
   * already returned `capped` for exactly this reason and the POS says so on
   * screen; this brings the same honesty to the reporting side.
   */
  capped: boolean;
};

/** Best sellers by profit, for the analytics page and the CSV export. */
export async function getProductProfit(
  limit = 50,
): Promise<Result<ProductProfitResult>> {
  const cap = Math.min(MAX_PRODUCT_PROFIT_ROWS, Math.max(1, Math.trunc(limit)));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_product_profit")
    .select("*")
    .order("gross_profit", { ascending: false })
    .limit(cap);

  if (error) return fail(error);
  const rows = (data ?? []) as ProductProfitRow[];
  return ok({ rows, capped: rows.length >= MAX_PRODUCT_PROFIT_ROWS });
}

export type StockRow = {
  product_id: string;
  name: string;
  sku: string | null;
  status: ProductStatus;
  quantity: number;
  low_stock_threshold: number;
  is_out_of_stock: boolean;
  is_low_stock: boolean;
  purchase_cost: number;
  selling_price: number;
};

/** Everything at or below its threshold. The flags come from `v_product_stock`. */
export async function getLowStock(limit = 50): Promise<Result<StockRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_product_stock")
    .select("*")
    .eq("status", "active")
    .or("is_out_of_stock.eq.true,is_low_stock.eq.true")
    .order("quantity", { ascending: true })
    .limit(Math.min(500, Math.max(1, Math.trunc(limit))));

  if (error) return fail(error);
  return ok((data ?? []) as StockRow[]);
}

export type LowStockCounts = { outOfStock: number; lowStock: number };

/**
 * Totals for the "needs attention" badges.
 *
 * A separate read from the list on purpose. Deriving the counts from the rows
 * already fetched would label them with the list's own limit — the dashboard
 * shows the top 8, so "3 out of stock" would really mean "3 of the 8 I happened
 * to load". These are `head: true` count queries, so no rows come back and the
 * number is the real total however many products are affected.
 *
 * Sold-out products are excluded from `lowStock`, because "0 in stock" is a
 * different problem from "running low" and mixing them makes one badge mean two
 * things.
 */
export async function getLowStockCounts(): Promise<Result<LowStockCounts>> {
  const supabase = await createClient();
  const [out, low] = await Promise.all([
    supabase
      .from("v_product_stock")
      .select("product_id", { count: "exact", head: true })
      .eq("status", "active")
      .eq("is_out_of_stock", true),
    supabase
      .from("v_product_stock")
      .select("product_id", { count: "exact", head: true })
      .eq("status", "active")
      .eq("is_low_stock", true)
      .eq("is_out_of_stock", false),
  ]);

  if (out.error) return fail(out.error);
  if (low.error) return fail(low.error);

  return ok({ outOfStock: out.count ?? 0, lowStock: low.count ?? 0 });
}

export type ChannelSplit = { channel: OrderChannel; revenue: number; orders: number };

/** Revenue by channel, for the dashboard. */
export async function getChannelSplit(
  fromDay: string,
  toDay: string,
): Promise<Result<ChannelSplit[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_sales_daily")
    .select("channel, revenue, orders_count")
    .gte("sale_date", fromDay)
    .lte("sale_date", toDay);

  if (error) return fail(error);

  const byChannel = new Map<OrderChannel, { revenue: number; orders: number }>();
  for (const row of (data ?? []) as { channel: OrderChannel; revenue: number; orders_count: number }[]) {
    const existing = byChannel.get(row.channel) ?? { revenue: 0, orders: 0 };
    byChannel.set(row.channel, {
      revenue: existing.revenue + row.revenue,
      orders: existing.orders + row.orders_count,
    });
  }

  return ok(
    [...byChannel.entries()].map(([channel, value]) => ({
      channel,
      revenue: roundMoney(value.revenue),
      orders: value.orders,
    })),
  );
}

export type DashboardKpis = SalesTotals & {
  openOrders: number;
};

/**
 * The dashboard's money figures.
 *
 * "Today" is an IST day, matching how the seller reads their own business, and
 * the range is today only — not "last 30 days" presented as if it were today.
 *
 * Low-stock counts are deliberately NOT read here. This used to fetch them
 * alongside, and returning its failure took the whole dashboard down with it —
 * revenue, orders, profit and contribution all disappeared because an advisory
 * badge could not be read. The admin layout already makes the opposite call on
 * the same query and says why: "A failure is not fatal: the admin simply gets no
 * badge, which is the right degradation for a number that informs rather than
 * gates." The page derives the counts from the list it already reads, so the
 * badges and the list below them also come from one snapshot instead of two
 * queries that can disagree.
 */
export async function getDashboardKpis(day = todayIst()): Promise<Result<DashboardKpis>> {
  const today = await getSalesTotals(day, day);
  if (!today.ok) return today;

  const supabase = await createClient();
  const { count, error } = await supabase
    .from("v_order_summary")
    .select("order_id", { count: "exact", head: true })
    .in("status", ["pending", "confirmed", "packed"]);

  if (error) return fail(error);

  return ok({
    ...today.data,
    openOrders: count ?? 0,
  });
}

/** Stock value at retail and at cost, for the dashboard's inventory figure. */
export async function getInventoryValue(): Promise<Result<{ atRetail: number; atCost: number; units: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_product_stock")
    .select("quantity, selling_price, purchase_cost")
    // Active only, like the low-stock list: draft and archived stock is not
    // inventory the business can sell, and counting it would overstate the figure
    // the dashboard shows next to today's revenue.
    .eq("status", "active");

  if (error) return fail(error);

  const rows = (data ?? []) as {
    quantity: number;
    selling_price: number;
    purchase_cost: number;
  }[];

  // multiplyMoney per row, then one rounded sum. Rounding each line first would
  // be defensible, but it would not match how the ledger rounds a real sale.
  return ok({
    atRetail: addMoney(...rows.map((row) => multiplyMoney(row.selling_price, row.quantity))),
    atCost: addMoney(...rows.map((row) => multiplyMoney(row.purchase_cost, row.quantity))),
    units: rows.reduce((total, row) => total + row.quantity, 0),
  });
}
