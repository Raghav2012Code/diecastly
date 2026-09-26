import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Order status as a shopper sees it.
 *
 * The mapping is presentation only. Whether an order has actually been cancelled
 * is the database's decision, made by `cancel_order`, and a pending order past
 * its `expires_at` is still pending until an admin acts on it (ux.md §11) — so
 * nothing here infers a status from a date.
 */
const STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "petrol" }> = {
  pending: { label: "Awaiting confirmation", tone: "warning" },
  confirmed: { label: "Confirmed", tone: "petrol" },
  packed: { label: "Packed", tone: "petrol" },
  shipped: { label: "Shipped", tone: "petrol" },
  delivered: { label: "Delivered", tone: "success" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
  returned: { label: "Returned", tone: "neutral" },
};

export function OrderStatusBadge({ status, className }: { status: string; className?: string }) {
  const known = STATUS[status];

  // An unrecognised status renders as itself rather than as a guess. Silently
  // mapping it to "pending" would tell a shopper their parcel is still being
  // confirmed when the database says something this build has never heard of.
  if (!known) {
    return (
      <Badge tone="neutral" className={cn(className)}>
        {status}
      </Badge>
    );
  }

  return (
    <Badge tone={known.tone} className={cn(className)}>
      {known.label}
    </Badge>
  );
}
