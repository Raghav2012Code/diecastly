import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { OrderFilters } from "@/components/admin/order-filters";
import { OrdersTable } from "@/components/admin/orders-table";
import { listOrders } from "@/lib/orders/data";
import { one, orderChannelParam, orderStatusParam, pageNumber, paymentStatusParam } from "@/lib/list-params";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const search = one(params.search);
  const status = orderStatusParam(params.status);
  const payment = paymentStatusParam(params.payment);
  const channel = orderChannelParam(params.channel);
  const from = one(params.from);
  const to = one(params.to);
  const page = pageNumber(params.page);

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
          <OrdersTable rows={rows} />

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
