import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getDashboardKpis, getInventoryValue, getLowStock, todayIst } from "@/lib/reports/data";
import { formatINR } from "@/lib/validation/money";
import { formatDateIST } from "@/lib/dates";

/**
 * The dashboard.
 *
 * "Today" is an IST day, so the figures match how the seller reads their own
 * business — `v_sales_daily` has already done the conversion in SQL, and this
 * only asks for one `sale_date`.
 *
 * Every figure comes from a view that excludes cancelled and returned orders, so
 * the dashboard cannot show revenue for a sale that was given back. That is the
 * Slice D exit condition, "reports reconcile with the ledger", and it is a
 * property of reading the view rather than of anything on this page.
 *
 * A failed read is stated as a failure rather than rendered as zeroes. A grid of
 * zeros is indistinguishable from a day with no sales, and the first of those is
 * a bug report that will never be filed.
 */
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const day = todayIst();
  const [kpis, stock, inventory] = await Promise.all([
    getDashboardKpis(day),
    getLowStock(8),
    getInventoryValue(),
  ]);

  if (!kpis.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" />
        <EmptyState
          title="Today's figures could not be loaded"
          description="Something went wrong reaching the reporting views. Please try again."
        />
      </div>
    );
  }

  const k = kpis.data;
  const money = (value: number) => formatINR(value);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Today, ${formatDateIST(new Date().toISOString())} IST.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Revenue" value={money(k.revenue)} hint={`${k.ordersCount} orders`} />
        <KpiCard label="Units sold" value={String(k.unitsSold)} hint="Across all channels" />
        <KpiCard
          label="Gross profit"
          value={money(k.grossProfit)}
          hint="After cost of goods"
        />
        <KpiCard
          label="After shipping"
          value={money(k.contributionAfterShipping)}
          hint="Gross profit plus shipping, less what it cost"
          muted
        />
        <KpiCard
          label="Open orders"
          value={String(k.openOrders)}
          hint="Pending, confirmed or packed"
          link="/admin/orders?status=pending"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Needs attention</CardTitle>
            <CardDescription>Stock that is low or gone, on active products.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Badge tone={k.outOfStockCount > 0 ? "danger" : "neutral"}>
                {k.outOfStockCount} out of stock
              </Badge>
              <Badge tone={k.lowStockCount > 0 ? "warning" : "neutral"}>
                {k.lowStockCount} running low
              </Badge>
            </div>

            {stock.ok && stock.data.length > 0 ? (
              <ul className="divide-y divide-border text-sm">
                {stock.data.map((row) => (
                  <li key={row.product_id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link
                      href={`/admin/products/${row.product_id}`}
                      className="min-w-0 truncate hover:underline"
                    >
                      {row.name}
                    </Link>
                    <Badge tone={row.is_out_of_stock ? "danger" : "warning"}>
                      {row.quantity === 0 ? "Sold out" : `${row.quantity} left`}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Every active product is comfortably in stock.
              </p>
            )}

            <Link
              href="/admin/inventory?scope=low"
              className="inline-block text-sm underline underline-offset-4"
            >
              See all low stock
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Stock on hand</CardTitle>
            <CardDescription>Active products only.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {inventory.ok ? (
              <>
                <Row label="Units" value={String(inventory.data.units)} />
                <Row label="At retail" value={money(inventory.data.atRetail)} />
                <Row label="At cost" value={money(inventory.data.atCost)} muted />
                <Row
                  label="Potential margin"
                  value={money(inventory.data.atRetail - inventory.data.atCost)}
                  muted
                />
              </>
            ) : (
              <p className="text-muted-foreground">Stock value could not be loaded.</p>
            )}
            <p className="pt-1 text-xs text-muted-foreground">
              Not a valuation. It is what the current prices and costs imply, and it moves
              every time a price does.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Today so far</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Item revenue" value={money(k.itemRevenue)} />
            <Row label="Shipping charged" value={money(k.shippingRevenue)} />
            <Row label="Cost of goods" value={money(k.cogs)} muted />
            <Row label="Net of shipping" value={money(k.contributionAfterShipping)} muted />
            <p className="pt-2 text-xs text-muted-foreground">
              Cancelled and returned orders are excluded from every figure here and on the
              reports, so these reconcile with the orders list.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  link,
  muted,
}: {
  label: string;
  value: string;
  hint?: string;
  link?: string;
  muted?: boolean;
}) {
  const body = (
    <Card className="h-full">
      <CardHeader className="pb-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={`text-2xl ${muted ? "text-muted-foreground" : ""}`}>{value}</CardTitle>
      </CardHeader>
      {hint ? <CardContent className="text-xs text-muted-foreground">{hint}</CardContent> : null}
    </Card>
  );

  return link ? (
    <Link href={link} className="transition-opacity hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tnum font-medium ${muted ? "text-muted-foreground" : ""}`}>{value}</span>
    </div>
  );
}
