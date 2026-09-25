"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { initialStockSchema } from "@/lib/validation/inventory";
import { setInitialStockAction } from "./actions";

export function OpeningStockDialog({
  productId,
  productName,
  unitCost,
}: {
  productId: string;
  productName: string;
  unitCost: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  function openDialog() {
    setQuantity("");
    setCost(unitCost != null ? String(unitCost) : "");
    setError(null);
    setOpen(true);
  }

  function submit() {
    const parsed = initialStockSchema.safeParse({
      productId,
      quantity,
      unitCost: cost.trim() === "" ? undefined : cost,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await setInitialStockAction(parsed.data);
      if (result.ok) {
        toast(`Opening stock recorded — ${productName} at ${result.data.quantity}`, "success");
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
        Set opening
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Set opening stock"
        description={`The starting count for ${productName}. It can be recorded only once.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : "Record opening stock"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Quantity" htmlFor="opening-quantity" required>
            <Input
              id="opening-quantity"
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
          <FormField label="Unit cost" htmlFor="opening-cost" hint="Optional. Updates the product's current cost.">
            <Input
              id="opening-cost"
              type="number"
              min="0"
              step="0.01"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              placeholder="0.00"
              className="tnum"
            />
          </FormField>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            If this was already recorded, the existing opening movement is kept and nothing changes.
          </p>
        </div>
      </Modal>
    </>
  );
}
