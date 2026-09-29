import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { OrderFilters } from "@/components/admin/order-filters";
import { OrdersTable } from "@/components/admin/orders-table";
import { FulfilmentActions } from "@/app/(admin)/admin/orders/fulfilment-actions";
import { listOrders } from "@/lib/orders/data";
import { lastPage, resolveListState } from "@/lib/list-state";
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
  const total = list.ok ? list.data.total : 0;
  const hasFilters = Boolean(
    search || status !== "all" || payment !== "all" || channel !== "all" || from || to,
  );

  // A page past the end must not fall into the "no orders" branch:
  // that tells the admin a populated ledger is empty with no way back.
  const outOfRange =
    resolveListState({ ok: list.ok, rowCount: rows.length, total, page, pageSize: 20, hasFilters }) ===
    "out-of-range";
  const lastPageHref = (() => {
    const query = new URLSearchParams();
    if (search) query.set("search", search);
    if (status !== "all") query.set("status", status);
    if (payment !== "all") query.set("payment", payment);
    if (channel !== "all") query.set("channel", channel);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    const target = lastPage(total, 20);
    if (target > 1) query.set("page", String(target));
    const qs = query.toString();
    return qs ? `/admin/orders?${qs}` : "/admin/orders";
  })();
  const listParams = {
    search,
    status: status === "all" ? undefined : status,
    payment: payment === "all" ? undefined : payment,
    channel: channel === "all" ? undefined : channel,
    from,
    to,
  };

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
          title={
            outOfRange
              ? "That page is past the end"
              : hasFilters
                ? "No orders match these filters"
                : "No orders yet"
          }
          description={
            outOfRange
              ? `There ${total === 1 ? "is 1 order" : `are ${total} orders`} in total, which do not reach page ${page}.`
              : hasFilters
                ? "Try a different search or date range, or clear the filters."
                : "Record an in-person sale and it will appear here."
          }
          action={
            outOfRange ? (
              <Link href={lastPageHref} className={buttonVariants()}>
                Go to page {lastPage(total, 20)}
              </Link>
            ) : hasFilters ? (
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
          <OrdersTable
        rows={rows}
        renderActions={(row) => (
          <FulfilmentActions
            orderId={row.order_id}
            orderNumber={row.order_number}
            status={row.status}
            channel={row.channel}
          />
        )}
      />

          <Pagination
            page={page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            basePath="/admin/orders"
            params={listParams}
          />
        </>
      )}

      {/* Pagination also renders when the page has no rows. The control already
          clamps to the last valid page; hiding it on the empty path removed the
          only way back from a page that no longer exists. */}
      {rows.length === 0 && total > 0 ? (
        <Pagination
          page={page}
          pageSize={20}
          total={total}
          basePath="/admin/orders"
          params={listParams}
        />
      ) : null}
    </div>
  );
}
