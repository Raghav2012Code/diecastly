import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  orderChannelLabel,
  orderStatusLabel,
  orderStatusTone,
  paymentStatusLabel,
  paymentStatusTone,
} from "@/lib/display";
import { formatDateTimeIST } from "@/lib/dates";
import { formatINR } from "@/lib/validation/money";
import type { VOrderSummaryRow } from "@/lib/types/database.types";

/** The orders table. Shared by the orders page and the preview harness. */
export function OrdersTable({ rows }: { rows: VOrderSummaryRow[] }) {
  return (
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
              <TableCell className="text-muted-foreground">{orderChannelLabel[row.channel]}</TableCell>
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
  );
}
