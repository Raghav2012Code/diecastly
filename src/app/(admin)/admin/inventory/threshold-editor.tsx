"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { updateThresholdAction } from "./actions";

export function ThresholdEditor({ productId, value }: { productId: string; value: number }) {
  const [draft, setDraft] = useState(String(value));
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  function save() {
    const parsed = Number(draft);
    if (!Number.isInteger(parsed) || parsed < 0) {
      toast("Threshold must be a whole number of zero or more.", "error");
      setDraft(String(value));
      return;
    }
    if (parsed === value) return;

    startTransition(async () => {
      const result = await updateThresholdAction({ productId, lowStockThreshold: parsed });
      if (result.ok) {
        toast("Threshold updated", "success");
        router.refresh();
      } else {
        toast(result.error, "error");
        setDraft(String(value));
      }
    });
  }

  return (
    <Input
      aria-label="Low-stock threshold"
      type="number"
      min="0"
      step="1"
      value={draft}
      disabled={pending}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="tnum h-8 w-20 text-right"
    />
  );
}
