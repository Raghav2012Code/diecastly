import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { orderStatusLabel, orderStatusTone } from "@/lib/display";
import { formatDateTimeIST } from "@/lib/dates";
import { formatINR } from "@/lib/validation/money";
import { expiryState } from "@/lib/orders/expiry";
import type { VOrderSummaryRow } from "@/lib/types/database.types";

/**
 * The pending-order queue: unfulfilled orders oldest first, with the
 * stock-hold expiry surfaced and overdue holds called out.
 *
 * One component for the dashboard and anywhere else the queue appears, so the
 * overdue reading cannot drift between them — the state comes from
 * `lib/orders/expiry.ts`, not from inline comparisons. Rows come from
 * `listOpenOrders`, the query written for this and previously never imported.
 */
export function OpenOrdersQueue({ rows, limit = 8 }: { rows: VOrderSummaryRow[]; limit?: number }) {
  const visible = rows.slice(0, limit);

  if (visible.length === 0) {
    return <p className="text-sm text-muted-foreground">No open orders — nothing waiting on fulfilment.</p>;
  }

  return (
    <div className="space-y-1">
      <ul className="divide-y divide-border">
        {visible.map((row) => {
          const state = expiryState(row.expires_at);
          return (
            <li key={row.order_id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/orders/${row.order_id}`}
                    className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                  >
                    {row.order_number}
                  </Link>
                  <Badge tone={orderStatusTone[row.status]} dot>
                    {orderStatusLabel[row.status]}
                  </Badge>
                  {state === "overdue" ? <Badge tone="danger">Hold expired</Badge> : null}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {row.customer_name ?? "Walk-in"} · placed {formatDateTimeIST(row.created_at)}
                  {row.expires_at
                    ? state === "overdue"
                      ? ` · hold expired ${formatDateTimeIST(row.expires_at)}`
                      : ` · hold until ${formatDateTimeIST(row.expires_at)}`
                    : ""}
                </p>
              </div>
              <span className="tnum shrink-0 text-sm font-medium">{formatINR(row.total)}</span>
            </li>
          );
        })}
      </ul>
      {rows.length > visible.length ? (
        <p className="pt-1 text-xs text-muted-foreground">
          Showing the {visible.length} oldest of {rows.length} open orders.{" "}
          <Link href="/admin/orders?status=pending" className="underline underline-offset-4">
            View all
          </Link>
        </p>
      ) : null}
    </div>
  );
}
