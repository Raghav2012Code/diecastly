"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { adjustSchema } from "@/lib/validation/inventory";
import {
  errorForField,
  fieldErrorFromZod,
  isErrorField,
  type FieldError,
} from "@/lib/validation/inventory";
import { newIdempotencyKey } from "@/lib/utils";
import { adjustAction } from "./actions";

type Direction = "increase" | "decrease";
type Reason = "adjustment" | "damage" | "loss" | "return";

const reasonHint: Record<Reason, string> = {
  adjustment: "Correct the count up or down.",
  damage: "Stock that was damaged and can no longer be sold.",
  loss: "Stock that went missing.",
  return: "Stock coming back, e.g. a late hand-back.",
};

export function AdjustDialog({
  productId,
  productName,
  currentQuantity,
}: {
  productId: string;
  productName: string;
  currentQuantity: number;
}) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<Direction>("decrease");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<Reason>("adjustment");
  const [note, setNote] = useState("");
  const [error, setError] = useState<FieldError | null>(null);
  const [pending, startTransition] = useTransition();
  const keyRef = useRef("");
  const { toast } = useToast();
  const router = useRouter();

  function openDialog() {
    keyRef.current = newIdempotencyKey();
    setDirection("decrease");
    setQuantity("");
    setReason("adjustment");
    setNote("");
    setError(null);
    setOpen(true);
  }

  function changeReason(next: Reason) {
    setReason(next);
    if (next === "damage" || next === "loss") setDirection("decrease");
    if (next === "return") setDirection("increase");
  }

  function submit() {
    const parsed = adjustSchema.safeParse({
      productId,
      direction,
      quantity,
      reason,
      note,
      idempotencyKey: keyRef.current,
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
    startTransition(async () => {
      const result = await adjustAction(parsed.data);
      if (result.ok) {
        toast(`${productName} now at ${result.data.quantity}`, "success");
        setOpen(false);
        router.refresh();
      } else {
        setError({ field: result.field ?? null, message: result.error });
        toast(result.error, "error");
      }
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={openDialog}>
        Adjust
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Adjust stock"
        description={`${currentQuantity} currently in stock for ${productName}.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : "Record adjustment"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Direction</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={direction === "decrease" ? "default" : "outline"}
                size="sm"
                disabled={reason === "return"}
                onClick={() => setDirection("decrease")}
              >
                Reduce
              </Button>
              <Button
                type="button"
                variant={direction === "increase" ? "default" : "outline"}
                size="sm"
                disabled={reason === "damage" || reason === "loss"}
                onClick={() => setDirection("increase")}
              >
                Add
              </Button>
            </div>
            {errorForField(error, "direction") ? (
              <p role="alert" className="text-sm text-destructive">
                {errorForField(error, "direction")}
              </p>
            ) : null}
          </div>

          <FormField
            label="Quantity"
            htmlFor="adjust-quantity"
            required
            error={errorForField(error, "quantity")}
          >
            <Input
              id="adjust-quantity"
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              aria-invalid={isErrorField(error, "quantity")}
              placeholder="0"
              className="tnum"
            />
          </FormField>

          <FormField
            label="Reason"
            htmlFor="adjust-reason"
            hint={reasonHint[reason]}
            error={errorForField(error, "reason")}
          >
            <Select
              id="adjust-reason"
              value={reason}
              onChange={(event) => changeReason(event.target.value as Reason)}
              aria-invalid={isErrorField(error, "reason")}
            >
              <option value="adjustment">Adjustment</option>
              <option value="damage">Damage</option>
              <option value="loss">Loss</option>
              <option value="return">Return</option>
            </Select>
          </FormField>

          <FormField
            label="Note"
            htmlFor="adjust-note"
            hint="Optional."
            error={errorForField(error, "note")}
          >
            <Input
              id="adjust-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-invalid={isErrorField(error, "note")}
              placeholder="Optional"
            />
          </FormField>

          {/* A failure that belongs to no single input still has to be shown. */}
          {error && error.field === null ? (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Stock can never go below zero — a reduction larger than the count is rejected.
          </p>
        </div>
      </Modal>
    </>
  );
}
