import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { getChannelSplit, getProductProfit, shiftIstDate, todayIst } from "@/lib/reports/data";
import { formatINR, roundMoney } from "@/lib/validation/money";

export const metadata: Metadata = { title: "Analytics" };

// Reporting reads the views on every request; a cached report is worse than none,
// because the seller would act on stale numbers believing they were current.
export const dynamic = "force-dynamic";

/**
 * Product performance and channel mix.
 *
 * Product profit is lifetime-to-date rather than a date range, because
 * `v_product_profit` groups by product with no date dimension — there is no
 * per-product time series in the schema, and inventing one client-side would mean
 * pulling every order line into memory to aggregate. The page says so rather than
 * implying a range it does not apply.
 *
 * Cancelled and returned orders are excluded by the view, so these margins
 * reconcile with the Sales page.
 */
export default async function AnalyticsPage() {
  const [profit, split] = await Promise.all([
    getProductProfit(50),
    getChannelSplit(shiftIstDate(todayIst(), -29), todayIst()),
  ]);

  if (!profit.ok || !split.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" />
        <EmptyState
          title="Analytics could not be loaded"
          description="Something went wrong reaching the reporting views. Please try again."
        />
      </div>
    );
  }

  const rows = profit.data;
  const channels = split.data;
  const totalRevenue = channels.reduce((sum, row) => sum + row.revenue, 0);
  const totalUnits = rows.reduce((sum, row) => sum + row.units_sold, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Which products actually make money, and where the orders come from."
        actions={
          <Link
            href="/admin/analytics/export"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Export product CSV
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Products sold</CardDescription>
            <CardTitle className="text-2xl">{rows.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {totalUnits} units in total
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Revenue, last 30 days</CardDescription>
            <CardTitle className="text-2xl">{formatINR(roundMoney(totalRevenue))}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">By channel, below</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Best seller</CardDescription>
            <CardTitle className="truncate text-2xl">
              {rows[0]?.product_name ?? "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {rows[0] ? `${rows[0].units_sold} units, ${formatINR(rows[0].gross_profit)} profit` : "No sales yet"}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Where orders come from</CardTitle>
          <CardDescription>Last 30 days.</CardDescription>
        </CardHeader>
        <CardContent>
          {channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders in the last 30 days.</p>
          ) : (
            <ul className="space-y-2">
              {channels.map((row) => {
                const share = totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0;
                return (
                  <li key={row.channel} className="flex items-center gap-3 text-sm">
                    <span className="w-20 shrink-0 font-medium">
                      {row.channel === "in_person" ? "In person" : "Online"}
                    </span>
                    <span
                      className="h-2 min-w-1 rounded-sm bg-primary/70"
                      style={{ width: `${Math.max(2, share)}%` }}
                    />
                    <span className="tnum ml-auto shrink-0">{formatINR(row.revenue)}</span>
                    <span className="tnum w-12 shrink-0 text-right text-xs text-muted-foreground">
                      {share.toFixed(0)}%
                    </span>
                    <span className="tnum w-16 shrink-0 text-right text-xs text-muted-foreground">
                      {row.orders} ord
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing sold yet"
          description="Product performance appears once something has been sold."
        />
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Product performance</CardTitle>
            <CardDescription>
              Lifetime to date, best margin first. Cancelled and returned orders are excluded.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <caption className="sr-only">Units, revenue and margin by product</caption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Gross profit</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  // Percentage of revenue, not of cost — and guarded, because a
                  // zero-revenue row would otherwise be a division by zero.
                  const margin =
                    row.item_revenue > 0 ? (row.gross_profit / row.item_revenue) * 100 : null;
                  return (
                    <TableRow key={row.product_id ?? row.product_name}>
                      <TableCell className="font-medium">
                        {row.product_id ? (
                          <Link
                            href={`/admin/products/${row.product_id}`}
                            className="hover:underline"
                          >
                            {row.product_name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{row.product_name}</span>
                        )}
                      </TableCell>
                      <TableCell className="tnum text-right">{row.units_sold}</TableCell>
                      <TableCell className="tnum text-right">{formatINR(row.item_revenue)}</TableCell>
                      <TableCell className="tnum text-right text-muted-foreground">
                        {formatINR(row.cogs)}
                      </TableCell>
                      <TableCell className="tnum text-right font-medium">
                        {formatINR(row.gross_profit)}
                      </TableCell>
                      <TableCell className="tnum text-right">
                        {margin === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Badge tone={margin >= 30 ? "success" : margin >= 15 ? "warning" : "neutral"}>
                            {margin.toFixed(0)}%
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
