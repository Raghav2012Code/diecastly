"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { setCustomerActiveAction } from "./actions";

/**
 * Archive or restore a customer.
 *
 * A boolean rather than a status enum, because a customer has no draft/published
 * lifecycle — the same shape a supplier uses. There is deliberately no delete:
 * `orders.customer_id` references the row and the order snapshots that carry
 * the customer's name and phone at write time must keep resolving to the same
 * record, so a hard delete would either fail or orphan the history (rule 3).
 */
export function CustomerArchiveButton({
  customerId,
  customerName,
  isActive,
}: {
  customerId: string;
  customerName: string;
  isActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  function confirm() {
    startTransition(async () => {
      const result = await setCustomerActiveAction({ customerId, isActive: !isActive });
      if (result.ok) {
        toast(isActive ? `${customerName} archived` : `${customerName} restored`, "success");
        setOpen(false);
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {isActive ? "Archive" : "Restore"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={isActive ? "Archive customer" : "Restore customer"}
        description={
          isActive
            ? `“${customerName}” will stop appearing in the till's customer picker. Their order history is kept, and orders already placed still show the name and phone they were placed with.`
            : `“${customerName}” will be offered again when a sale is attached to an existing customer.`
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant={isActive ? "destructive" : "default"} onClick={confirm} disabled={pending}>
              {pending ? "Saving…" : isActive ? "Archive customer" : "Restore customer"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Customers are never deleted — the order history keeps its link to this record.
        </p>
      </Modal>
    </>
  );
}
