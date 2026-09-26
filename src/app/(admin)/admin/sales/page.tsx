import { buttonVariants } from "@/components/ui/button";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SalesRangePicker } from "@/app/(admin)/admin/sales/range-picker";
import { getSalesSeries, getSalesTotals, shiftIstDate, todayIst } from "@/lib/reports/data";
import { formatINR } from "@/lib/validation/money";
import { formatDateIST } from "@/lib/dates";

export const metadata: Metadata = { title: "Sales" };

// Reporting reads the views on every request. A cached report is worse than no
// report: the seller would act on yesterday's numbers believing they were today's.
export const dynamic = "force-dynamic";

const RANGES = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pick(value: string | string[] | undefined, fallback: string): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && /^\d{4}-\d{2}-\d{2}$/.test(first) ? first : fallback;
}

/**
 * Sales over a date range.
 *
 * Defaults to the last 7 days INCLUDING today, because "today so far" is what a
 * seller opens this page for and a range that ended yesterday would silently
 * omit the only day they care about.
 *
 * Both ends of the range are validated as plain ISO days. An unrecognised value
 * falls back to the default rather than being passed through to a date
 * comparison, which is the mistake the admin list filters were written to avoid.
 */
export default async function SalesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const today = todayIst();

  const days = Number(Array.isArray(params.days) ? params.days[0] : params.days) || 7;
  const range = RANGES.find((r) => r.days === days) ?? RANGES[0];

  const toDay = pick(params.to, today);
  const fromDay = pick(params.from, shiftIstDate(toDay, -(range.days - 1)));

  const [totals, series] = await Promise.all([getSalesTotals(fromDay, toDay), getSalesSeries(fromDay, toDay)]);

  if (!totals.ok || !series.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Sales" />
        <EmptyState
          title="Sales could not be loaded"
          description="Something went wrong reaching the reporting views. Please try again."
        />
      </div>
    );
  }

  const t = totals.data;
  const days_ = series.data;
  const best = days_.reduce<(typeof days_)[number] | null>(
    (top, day) => (top === null || day.revenue > top.revenue ? day : top),
    null,
  );
  const peak = best ? best.revenue : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        description={`${formatDateIST(`${fromDay}T00:00:00Z`)} to ${formatDateIST(`${toDay}T00:00:00Z`)} IST`}
        actions={
          // A plain link rather than a button: the export is a route handler, so this is
          // a real URL that can be bookmarked, shared, and opened in a new tab.
          <a
            href={`/admin/sales/export?from=${encodeURIComponent(fromDay)}&to=${encodeURIComponent(toDay)}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Export CSV
          </a>
        }
      />

      <SalesRangePicker
        ranges={RANGES.map((r) => ({ key: r.key, label: r.label, days: r.days }))}
        current={{ days: range.key, from: fromDay, to: toDay }}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Revenue</CardDescription>
            <CardTitle className="text-2xl">{formatINR(t.revenue)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {formatINR(t.itemRevenue)} items + {formatINR(t.shippingRevenue)} shipping
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Gross profit</CardDescription>
            <CardTitle className="text-2xl">{formatINR(t.grossProfit)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            After {formatINR(t.cogs)} of cost of goods
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>After shipping</CardDescription>
            <CardTitle className="text-2xl text-muted-foreground">
              {formatINR(t.contributionAfterShipping)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Gross profit plus shipping charged, less what it cost
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Orders</CardDescription>
            <CardTitle className="text-2xl">{t.ordersCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {t.unitsSold} units sold
          </CardContent>
        </Card>
      </div>

      {days_.length === 0 ? (
        <EmptyState
          title="Nothing sold in this range"
          description="There are no orders between these dates. Try a wider range."
        />
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By day</CardTitle>
            <CardDescription>
              Cancelled and returned orders are excluded, so this reconciles with the orders
              list.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* A plain bar list rather than a chart library: one dependency-free
                component that prints exactly the numbers in the table below, which
                is what the seller will check them against. */}
            <ul className="mb-4 space-y-1.5">
              {days_.map((day) => (
                <li key={day.day} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 text-muted-foreground">
                    {formatDateIST(`${day.day}T00:00:00Z`)}
                  </span>
                  <span className="h-2 min-w-1 rounded-sm bg-primary/70" style={{
                    // Guard against a zero peak, which would divide by zero.
                    width: peak > 0 ? `${Math.max(2, (day.revenue / peak) * 100)}%` : "2%",
                  }} />
                  <span className="tnum ml-auto shrink-0 font-medium">{formatINR(day.revenue)}</span>
                </li>
              ))}
            </ul>

            <Table>
              <caption className="sr-only">Daily sales for the selected range</caption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Gross profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days_.map((day) => (
                  <TableRow key={day.day}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateIST(`${day.day}T00:00:00Z`)}
                    </TableCell>
                    <TableCell className="tnum text-right">{day.orders}</TableCell>
                    <TableCell className="tnum text-right font-medium">
                      {formatINR(day.revenue)}
                    </TableCell>
                    <TableCell className="tnum text-right">{formatINR(day.grossProfit)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Figures come from the reporting views, which exclude cancelled and returned orders.
        <Link href="/admin/orders" className="ml-1 underline underline-offset-4">
          Compare with the orders list
        </Link>
        .
      </p>
    </div>
  );
}
