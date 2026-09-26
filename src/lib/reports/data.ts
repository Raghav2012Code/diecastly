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

// getProductProfit is a hoisted function declaration, so getSalesTotals below can
// call it even though it is defined further down this file.
export type SalesRow = {
  sale_date: string;
  channel: OrderChannel;
  orders_count: number;
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

  // Units come from v_product_profit, not from v_sales_daily. The daily view
  // counts ORDERS, and labelling that "units sold" would overstate every
  // multi-item order by its line count. The profit view sums order_items.quantity
  // and already excludes cancelled and returned orders, so it agrees with every
  // other figure here.
  const units = await getProductProfit(500);
  if (!units.ok) return units;

  return ok({
    ordersCount: rows.reduce((total, row) => total + row.orders_count, 0),
    unitsSold: units.data.reduce((total, row) => total + row.units_sold, 0),
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
): Promise<Result<{ day: string; revenue: number; grossProfit: number; orders: number }[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_sales_daily")
    .select("*")
    .gte("sale_date", fromDay)
    .lte("sale_date", toDay)
    .order("sale_date", { ascending: true });

  if (error) return fail(error);

  const byDay = new Map<string, { revenue: number; grossProfit: number; orders: number }>();
  for (const row of (data ?? []) as SalesRow[]) {
    const existing = byDay.get(row.sale_date) ?? { revenue: 0, grossProfit: 0, orders: 0 };
    byDay.set(row.sale_date, {
      // accumulate as arrays then round once, for the same reason as above
      revenue: existing.revenue + row.revenue,
      grossProfit: existing.grossProfit + row.gross_profit,
      orders: existing.orders + row.orders_count,
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

/** Best sellers by profit, for the analytics page and the CSV export. */
export async function getProductProfit(
  limit = 50,
): Promise<Result<ProductProfitRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_product_profit")
    .select("*")
    .order("gross_profit", { ascending: false })
    .limit(Math.min(500, Math.max(1, Math.trunc(limit))));

  if (error) return fail(error);
  return ok((data ?? []) as ProductProfitRow[]);
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
  lowStockCount: number;
  outOfStockCount: number;
};

/**
 * The dashboard's numbers.
 *
 * "Today" is an IST day, matching how the seller reads their own business, and
 * the range is today only — not "last 30 days" presented as if it were today.
 */
export async function getDashboardKpis(day = todayIst()): Promise<Result<DashboardKpis>> {
  const [today, low] = await Promise.all([getSalesTotals(day, day), getLowStock(200)]);
  if (!today.ok) return today;
  if (!low.ok) return low;

  const supabase = await createClient();
  const { count, error } = await supabase
    .from("v_order_summary")
    .select("order_id", { count: "exact", head: true })
    .in("status", ["pending", "confirmed", "packed"]);

  if (error) return fail(error);

  return ok({
    ...today.data,
    openOrders: count ?? 0,
    lowStockCount: low.data.filter((row) => row.is_low_stock && !row.is_out_of_stock).length,
    outOfStockCount: low.data.filter((row) => row.is_out_of_stock).length,
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
