import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { OrderDetailView } from "@/components/admin/order-detail-view";
import { getOrderDetail } from "@/lib/orders/data";
import { PaymentDialogs } from "./payment-dialogs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Order" };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getOrderDetail(id);
  if (!result.ok) {
    return (
      <div className="space-y-4">
        <Link href="/admin/orders" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft className="h-4 w-4" />
          Orders
        </Link>
        <Card className="p-6">
          <p className="font-display text-lg font-bold">Order could not be loaded</p>
          <p className="mt-1 text-sm text-muted-foreground">{result.error.message}</p>
        </Card>
      </div>
    );
  }
  if (!result.data) notFound();

  const { financials, order } = result.data;

  return (
    <OrderDetailView
      detail={result.data}
      actions={
        <>
          <Link
            href={`/admin/orders/${id}/receipt?print=1`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            <Printer className="h-4 w-4" />
            Print receipt
          </Link>
          <PaymentDialogs
            orderId={id}
            balance={financials.balance}
            netPaid={financials.net_paid}
            defaultMethod={order.payment_method ?? "cash"}
          />
        </>
      }
    />
  );
}
