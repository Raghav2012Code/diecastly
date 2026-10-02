import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getCustomer, listCustomerOrders } from "@/lib/customers/data";
import { formatDateTimeIST } from "@/lib/dates";
import { formatINR } from "@/lib/validation/money";
import { CustomerFormDialog } from "../customer-form-dialog";
import { CustomerArchiveButton } from "../customer-archive-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer" };

/**
 * One customer and the orders that reference them.
 *
 * Everything here is a READ. `orders` is a ledger table, so the history comes
 * from `v_order_summary` and nothing on this page can change it (rule 1); the
 * only writes offered are the customer metadata edits and the archive flag,
 * which is the metadata lane.
 *
 * The order list is deliberately the **snapshot** name and phone rather than a
 * join back to `customers`: an order records who it was placed by at write
 * time, so a later rename must not rewrite history. That is why editing a
 * customer here says "changes apply to future orders".
 */
export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const customer = await getCustomer(id);
  if (!customer.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Customer" description="That customer could not be loaded." />
        <EmptyState
          title="Customer not available"
          description="Something went wrong reaching this customer. Please try again."
          action={
            <Link href="/admin/customers" className="text-sm underline underline-offset-4">
              Back to customers
            </Link>
          }
        />
      </div>
    );
  }

  if (!customer.data) notFound();

  const row = customer.data;

  // Read after the notFound() guard so a missing customer never issues a second
  // query for orders that cannot exist.
  const orders = await listCustomerOrders(row.id);
  const orderRows = orders.ok ? orders.data : [];

  const counted = orderRows.filter((order) => order.status !== "cancelled" && order.status !== "returned");
  const lifetime = counted.reduce((sum, order) => sum + order.total, 0);
  const address = [
    row.address_line1,
    row.address_line2,
    [row.city, row.state, row.postal_code].filter(Boolean).join(", "),
    row.country,
  ]
    .filter((part) => part && part.trim().length > 0)
    .join("\n");

  return (
    <div className="space-y-6">
      <PageHeader
        title={row.name || "(no name)"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{row.phone_normalized ?? "—"}</span>
            {row.is_active ? null : <Badge tone="outline">archived</Badge>}
          </span>
        }
        actions={
          <>
            <Link href="/admin/customers" className={buttonVariants({ variant: "outline" })}>
              Back
            </Link>
            <CustomerFormDialog mode="edit" customer={row} />
            <CustomerArchiveButton customerId={row.id} customerName={row.name ?? "customer"} isActive={row.is_active} />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <h2 className="font-display text-lg font-semibold">Details</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{row.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Address</dt>
              <dd className="whitespace-pre-line">{address || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="whitespace-pre-line">{row.notes ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Added</dt>
              <dd>{formatDateTimeIST(row.created_at)}</dd>
            </div>
          </dl>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="font-display text-lg font-semibold">Orders</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {orderRows.length === 0
              ? "No orders yet."
              : `${orderRows.length} order${orderRows.length === 1 ? "" : "s"}, ${counted.length} counted toward ${formatINR(lifetime)}.`}
          </p>

          {orderRows.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No orders yet"
                description="This customer appears here as soon as an order is placed against their phone number."
              />
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Order</TableHead>
                    <TableHead>Placed</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderRows.map((order) => (
                    <TableRow key={order.order_id}>
                      <TableCell className="font-mono text-xs">
                        <Link
                          href={`/admin/orders/${order.order_id}`}
                          className="underline underline-offset-4"
                        >
                          {order.order_number}
                        </Link>
                        <span className="ml-2 text-muted-foreground">
                          {order.customer_name} · {order.customer_phone}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTimeIST(order.created_at)}
                      </TableCell>
                      <TableCell>{order.status}</TableCell>
                      <TableCell className="tnum text-right font-medium">
                        {formatINR(order.total)}
                      </TableCell>
                      <TableCell className="tnum text-right">
                        {order.balance === 0 ? "—" : formatINR(order.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
