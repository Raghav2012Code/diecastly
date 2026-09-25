import { cn } from "@/lib/utils";

export type StockTone = "ok" | "low" | "out";

const TICKS = 20;

/** Stock state from the single source of truth: quantity vs. threshold. */
export function stockTone(quantity: number, threshold: number): StockTone {
  if (quantity <= 0) return "out";
  if (quantity <= threshold) return "low";
  return "ok";
}

const toneBar: Record<StockTone, string> = {
  ok: "bg-petrol",
  low: "bg-warning",
  out: "bg-destructive",
};

/**
 * Segmented level meter — the admin's signature stock readout. Filled ticks are
 * relative to the largest quantity on the visible page, so rows are comparable
 * at a glance; the exact number always sits beside it.
 */
export function StockBar({
  quantity,
  max,
  tone,
  className,
}: {
  quantity: number;
  max: number;
  tone: StockTone;
  className?: string;
}) {
  const ratio = max > 0 ? quantity / max : 0;
  const filled = quantity <= 0 ? 0 : Math.max(1, Math.round(ratio * TICKS));

  return (
    <div aria-hidden className={cn("flex h-1.5 w-full gap-px overflow-hidden rounded-sm", className)}>
      {Array.from({ length: TICKS }, (_, index) => (
        <span
          key={index}
          className={cn("h-full flex-1", index < filled ? toneBar[tone] : "bg-border")}
        />
      ))}
    </div>
  );
}
