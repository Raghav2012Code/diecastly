import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OrderFilters } from "@/components/admin/order-filters";
import { listOrders } from "@/lib/orders/data";
import {
  orderChannelLabel,
  orderStatusLabel,
  orderStatusTone,
  paymentStatusLabel,
  paymentStatusTone,
} from "@/lib/display";
import { formatDateTimeIST } from "@/lib/dates";
import { formatINR } from "@/lib/validation/money";
import type { DerivedPaymentStatus, OrderChannel, OrderStatus } from "@/lib/types/database.types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const search = one(params.search);
  const status = (one(params.status) ?? "all") as OrderStatus | "all";
  const payment = (one(params.payment) ?? "all") as DerivedPaymentStatus | "all";
  const channel = (one(params.channel) ?? "all") as OrderChannel | "all";
  const from = one(params.from);
  const to = one(params.to);
  const page = Number.parseInt(one(params.page) ?? "1", 10) || 1;

  const list = await listOrders({
    search,
    status,
    paymentStatus: payment,
    channel,
    from,
    to,
    page,
    pageSize: 20,
  });
  const rows = list.ok ? list.data.rows : [];
  const hasFilters = Boolean(
    search || status !== "all" || payment !== "all" || channel !== "all" || from || to,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Every sale and online order. Payment state is derived from the payments ledger, fulfilment is separate."
        actions={
          <Link href="/admin/pos" className={buttonVariants()}>
            Record sale
          </Link>
        }
      />

      <OrderFilters current={{ search, status, payment, channel, from, to }} />

      {!list.ok ? (
        <EmptyState
          title="Orders could not be loaded"
          description={list.error.message}
          action={
            <Link href="/admin/orders" className={buttonVariants({ variant: "outline" })}>
              Try again
            </Link>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={hasFilters ? "No orders match these filters" : "No orders yet"}
          description={
            hasFilters
              ? "Try a different search or date range, or clear the filters."
              : "Record an in-person sale and it will appear here."
          }
          action={
            hasFilters ? (
              <Link href="/admin/orders" className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            ) : (
              <Link href="/admin/pos" className={buttonVariants()}>
                Record sale
              </Link>
            )
          }
        />
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Order</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Fulfilment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.order_id}>
                    <TableCell>
                      <Link
                        href={`/admin/orders/${row.order_id}`}
                        className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                      >
                        {row.order_number}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTimeIST(row.created_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {orderChannelLabel[row.channel]}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{row.customer_name ?? "Walk-in"}</p>
                      {row.customer_phone ? (
                        <p className="font-mono text-xs text-muted-foreground">{row.customer_phone}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="tnum text-right font-medium">{formatINR(row.total)}</TableCell>
                    <TableCell>
                      <Badge tone={paymentStatusTone[row.payment_status]}>
                        {paymentStatusLabel[row.payment_status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge tone={orderStatusTone[row.status]} dot>
                        {orderStatusLabel[row.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Pagination
            page={page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            basePath="/admin/orders"
            params={{
              search,
              status: status === "all" ? undefined : status,
              payment: payment === "all" ? undefined : payment,
              channel: channel === "all" ? undefined : channel,
              from,
              to,
            }}
          />
        </>
      )}
    </div>
  );
}
