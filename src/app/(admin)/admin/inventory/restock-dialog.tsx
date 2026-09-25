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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const keyRef = useRef("");
  const { toast } = useToast();
  const router = useRouter();

  function openDialog() {
    keyRef.current = newIdempotencyKey();
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
      idempotencyKey: keyRef.current,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await restockAction(parsed.data);
      if (result.ok) {
        toast(`${productName} now at ${result.data.quantity}`, "success");
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
          <FormField label="Quantity received" htmlFor="restock-quantity" required>
            <Input
              id="restock-quantity"
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              aria-invalid={Boolean(error)}
              placeholder="0"
              className="tnum"
              autoFocus
            />
          </FormField>
          <FormField label="Unit cost" htmlFor="restock-cost" hint="Leave as is to keep the existing cost.">
            <Input
              id="restock-cost"
              type="number"
              min="0"
              step="0.01"
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
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
          <FormField label="Note" htmlFor="restock-note" error={error}>
            <Input
              id="restock-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional, e.g. invoice number"
            />
          </FormField>
          <p className="text-xs text-muted-foreground">
            Past sale cost snapshots are never rewritten by a restock.
          </p>
        </div>
      </Modal>
    </>
  );
}
