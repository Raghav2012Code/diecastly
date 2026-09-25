import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { OrderReceipt } from "@/components/admin/order-receipt";
import { getOrderReceipt } from "@/lib/orders/data";
import { receiptFromOrder } from "@/lib/orders/receipt";
import { ReceiptActions } from "./receipt-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receipt" };

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const { id } = await params;
  const { print } = await searchParams;

  const result = await getOrderReceipt(id);
  if (!result.ok) {
    return (
      <EmptyState
        title="The receipt could not be loaded"
        description={result.error.message}
        action={
          <Link href={`/admin/orders/${id}`} className={buttonVariants({ variant: "outline" })}>
            Back to order
          </Link>
        }
      />
    );
  }
  if (!result.data) notFound();

  const receipt = receiptFromOrder(result.data);

  return (
    <div className="mx-auto w-full max-w-[23rem] space-y-4 py-2">
      <ReceiptActions orderId={id} autoPrint={print === "1"} />
      <OrderReceipt receipt={receipt} />
    </div>
  );
}
