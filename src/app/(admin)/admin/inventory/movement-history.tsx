"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { movementSourceLabel, movementTypeLabel, movementTypeTone } from "@/lib/display";
import { formatDateTimeIST } from "@/lib/dates";
import type { InventoryMovementWithProduct } from "@/lib/types/database.types";
import { cn } from "@/lib/utils";
import { productMovementsAction } from "./actions";

function Delta({ value }: { value: number }) {
  const positive = value > 0;
  return (
    <span className={cn("tnum font-medium", positive ? "text-success" : "text-foreground")}>
      {positive ? `+${value}` : value}
    </span>
  );
}

/** The modal is a preview, not the full ledger; the copy has to say so. */
const MOVEMENT_HISTORY_LIMIT = 100;

export function MovementHistoryButton({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<InventoryMovementWithProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openDialog() {
    setOpen(true);
    setRows(null);
    setError(null);
    startTransition(async () => {
      const result = await productMovementsAction(productId, MOVEMENT_HISTORY_LIMIT);
      if (result.ok) setRows(result.data as InventoryMovementWithProduct[]);
      else setError(result.error);
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={openDialog}>
        History
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Movement history"
        description={`The latest ${MOVEMENT_HISTORY_LIMIT} stock changes for ${productName}, newest first.`}
      >
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : pending || rows === null ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No movements yet. Restock or adjust to start the ledger.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2 text-right">Change</th>
                  <th className="px-2 py-2 text-right">After</th>
                  <th className="px-2 py-2">Source</th>
                  <th className="px-2 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/70 last:border-b-0">
                    <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                      {formatDateTimeIST(row.created_at)}
                    </td>
                    <td className="px-2 py-2">
                      <Badge tone={movementTypeTone[row.movement_type]}>
                        {movementTypeLabel[row.movement_type]}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Delta value={row.delta} />
                    </td>
                    <td className="tnum px-2 py-2 text-right">{row.quantity_after}</td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {movementSourceLabel[row.source] ?? row.source}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{row.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </>
  );
}
