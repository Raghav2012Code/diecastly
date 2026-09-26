"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { restockSchema } from "@/lib/validation/inventory";
import {
  errorForField,
  fieldErrorFromZod,
  isErrorField,
  keyForIntent,
  type FieldError,
} from "@/lib/validation/inventory";
import { newIdempotencyKey } from "@/lib/utils";
import { restockAction } from "./actions";

export function RestockDialog({
  productId,
  productName,
  currentCost,
}: {
  productId: string;
  productName: string;
  currentCost: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [setCurrentCost, setSetCurrentCost] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<FieldError | null>(null);
  const [pending, startTransition] = useTransition();
  // Scoped to the intent, not to the dialog: see keyForIntent.
  const keyRef = useRef<{ key: string; fingerprint: string } | null>(null);
  const { toast } = useToast();
  const router = useRouter();

  function openDialog() {
    // A fresh dialog is a fresh intent, even with identical values.
    keyRef.current = null;
    setQuantity("");
    setUnitCost(currentCost != null ? String(currentCost) : "");
    setSetCurrentCost(false);
    setNote("");
    setError(null);
    setOpen(true);
  }

  function submit() {
    const parsed = restockSchema.safeParse({
      productId,
      quantity,
      unitCost: unitCost.trim() === "" ? undefined : unitCost,
      setCurrentCost,
      note,
      idempotencyKey: "",
    });
    if (!parsed.success) {
      // Both channels: a toast, because the client-side path used to be silent,
      // and the field error, so the message appears where the input is.
      const mapped = fieldErrorFromZod(parsed.error);
      setError(mapped);
      toast(mapped.message, "error");
      return;
    }
    setError(null);

    // A key identifies one intent. Reuse it only while the request is
    // unchanged, so a lost response can be retried safely but a corrected
    // quantity is a new request and actually gets applied.
    const data = parsed.data;
    const scoped = keyForIntent(
      keyRef.current,
      { quantity: data.quantity, unitCost: data.unitCost, setCurrentCost: data.setCurrentCost },
      newIdempotencyKey,
    );
    keyRef.current = scoped;

    startTransition(async () => {
      const result = await restockAction({ ...data, idempotencyKey: scoped.key });
      if (result.ok) {
        toast(
          result.data.repeated
            ? `Already recorded — ${productName} still at ${result.data.quantity}`
            : `${productName} now at ${result.data.quantity}`,
          result.data.repeated ? "error" : "success",
        );
        if (!result.data.repeated) {
          setOpen(false);
        }
        router.refresh();
      } else {
        setError({ field: result.field ?? null, message: result.error });
        toast(result.error, "error");
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        Restock
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Restock"
        description={`Add received stock to ${productName}.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : "Add stock"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField
            label="Quantity received"
            htmlFor="restock-quantity"
            required
            error={errorForField(error, "quantity")}
          >
            <Input
              id="restock-quantity"
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              aria-invalid={isErrorField(error, "quantity")}
              placeholder="0"
              className="tnum"
              autoFocus
            />
          </FormField>
          <FormField
            label="Unit cost"
            htmlFor="restock-cost"
            hint="Leave as is to keep the existing cost."
            error={errorForField(error, "unitCost")}
          >
            <Input
              id="restock-cost"
              type="number"
              min="0"
              step="0.01"
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
              aria-invalid={isErrorField(error, "unitCost")}
              placeholder="0.00"
              className="tnum"
            />
          </FormField>
          <label className="flex items-center gap-2.5 text-sm">
            <Checkbox
              checked={setCurrentCost}
              onChange={(event) => setSetCurrentCost(event.target.checked)}
            />
            Update the product&apos;s current cost to this value
          </label>
          <FormField
            label="Note"
            htmlFor="restock-note"
            hint="Optional, e.g. invoice number."
            error={errorForField(error, "note")}
          >
            <Input
              id="restock-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-invalid={isErrorField(error, "note")}
              placeholder="Optional, e.g. invoice number"
            />
          </FormField>
          {/* A failure that belongs to no single input still has to be shown. */}
          {error && error.field === null ? (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Past sale cost snapshots are never rewritten by a restock.
          </p>
        </div>
      </Modal>
    </>
  );
}
