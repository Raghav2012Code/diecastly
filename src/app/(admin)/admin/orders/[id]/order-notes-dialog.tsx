"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { orderNotesSchema } from "@/lib/validation/order";
import { updateOrderNotesAction } from "../actions";

const MAX_LENGTH = 2000;

/**
 * Edit an order's free-text note. Non-financial, so it carries no idempotency
 * key and no confirmation step: the previous value is shown in the field, and
 * cancel discards. The `update_order_notes` RPC is the only writer.
 */
export function OrderNotesDialog({
  orderId,
  orderNumber,
  notes,
}: {
  orderId: string;
  orderNumber: string;
  notes: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  function openDialog() {
    setValue(notes ?? "");
    setError(null);
    setOpen(true);
  }

  function submit() {
    const parsed = orderNotesSchema.safeParse({ orderId, notes: value });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid note.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await updateOrderNotesAction(parsed.data);
      if (result.ok) {
        toast(`Note saved on ${orderNumber}`, "success");
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
        toast(result.error, "error");
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={openDialog}>
        {notes ? "Edit note" : "Add note"}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="md"
        title="Order note"
        description="Internal note about this order. It is not shown to the customer and does not change money or stock."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : "Save note"}
            </Button>
          </>
        }
      >
        <FormField
          label="Note"
          htmlFor="order-note"
          error={error}
          hint={`${value.length}/${MAX_LENGTH}`}
        >
          <Textarea
            id="order-note"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={MAX_LENGTH}
            rows={5}
            placeholder="Optional — e.g. “customer will collect on Saturday”."
            autoFocus
            aria-invalid={Boolean(error)}
          />
        </FormField>
      </Modal>
    </>
  );
}
