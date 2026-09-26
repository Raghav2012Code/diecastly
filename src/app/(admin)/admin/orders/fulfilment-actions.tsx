"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { advanceOrderAction, cancelOrderAction } from "@/app/(admin)/admin/orders/actions";
import { canCancel, nextStatus, nextStatusLabel } from "@/lib/validation/fulfilment";
import type { OrderChannel, OrderStatus } from "@/lib/types/database.types";

/**
 * The fulfilment controls on an order row.
 *
 * One forward button, because the transition table is a chain and there is
 * exactly one legal next step. A dropdown of every status would be mostly
 * invalid options, and the server would reject the invalid ones anyway.
 *
 * Shipping is the one step that collects more than a click, because a courier
 * and a tracking number are what make a shipment followable — and the customer
 * sees them on their order page. The dialog is optional: leaving them blank
 * moves the order to `shipped` and the fields simply stay unset, because a
 * shop that drops off at the counter should not be forced to invent a courier.
 *
 * Every action disables its button while in flight. No optimistic status change:
 * fulfilment state is the database's word, and a screen that says "shipped"
 * before the RPC has agreed is worse than one that waits (ux.md §12).
 */
export function FulfilmentActions({
  orderId,
  orderNumber,
  status,
  channel,
}: {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  channel: OrderChannel;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [advancing, setAdvancing] = React.useState(false);
  const [shipOpen, setShipOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const next = nextStatus(status);
  const label = nextStatusLabel(status);
  const cancellable = canCancel(status, channel);

  async function advance(
    newStatus: OrderStatus,
    extra?: { courier?: string; tracking?: string },
  ) {
    setAdvancing(true);
    setError(null);
    const result = await advanceOrderAction({ orderId, newStatus, ...extra });
    setAdvancing(false);

    if (!result.ok) {
      setError(result.error);
      toast(result.error, "error");
      return;
    }

    setShipOpen(false);
    toast(`${orderNumber} is now ${newStatus}.`, "success");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {next ? (
        next === "shipped" ? (
          <Button size="sm" variant="outline" disabled={advancing} onClick={() => setShipOpen(true)}>
            {label}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={advancing}
            onClick={() => void advance(next)}
          >
            {label}
          </Button>
        )
      ) : null}

      {cancellable ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={advancing}
          onClick={() => setCancelOpen(true)}
          className="text-destructive hover:bg-destructive/10"
        >
          {status === "completed" ? "Reverse sale" : "Cancel"}
        </Button>
      ) : null}

      {error ? (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <Modal
        open={shipOpen}
        onClose={() => setShipOpen(false)}
        title={`Ship ${orderNumber}`}
        description="Optional, but the customer sees these on their order page."
      >
        <ShipForm
          busy={advancing}
          onCancel={() => setShipOpen(false)}
          onSubmit={(courier, tracking) => void advance("shipped", { courier, tracking })}
        />
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={status === "completed" ? `Reverse ${orderNumber}` : `Cancel ${orderNumber}`}
        description={
          status === "completed"
            ? "This puts the stock back and reverses the money. Only possible inside the reversal window."
            : "This puts the stock back and refunds anything paid."
        }
      >
        <CancelForm
          busy={advancing}
          onCancel={() => setCancelOpen(false)}
          onSubmit={async (reason, restock, refund) => {
            setAdvancing(true);
            setError(null);
            const result = await cancelOrderAction({ orderId, reason, restock, refund });
            setAdvancing(false);
            if (!result.ok) {
              setError(result.error);
              toast(result.error, "error");
              return;
            }
            setCancelOpen(false);
            toast(`${orderNumber} cancelled.`, "success");
            router.refresh();
          }}
        />
      </Modal>
    </div>
  );
}

function ShipForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (courier: string, tracking: string) => void;
}) {
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSubmit(String(data.get("courier") ?? "").trim(), String(data.get("tracking") ?? "").trim());
      }}
    >
      <FormField label="Courier" htmlFor="courier" hint="Leave blank if you deliver it yourself.">
        <Input id="courier" name="courier" maxLength={120} autoFocus />
      </FormField>
      <FormField label="Tracking number" htmlFor="tracking">
        <Input id="tracking" name="tracking" maxLength={120} />
      </FormField>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Not now
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Shipping…" : "Mark shipped"}
        </Button>
      </div>
    </form>
  );
}

function CancelForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (reason: string, restock: boolean, refund: boolean) => void;
}) {
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSubmit(
          String(data.get("reason") ?? "").trim(),
          data.get("restock") === "on",
          data.get("refund") === "on",
        );
      }}
    >
      <FormField
        label="Reason"
        htmlFor="reason"
        required
        hint="Kept on the order's history so the next person to read it knows why."
      >
        <Input id="reason" name="reason" maxLength={300} required autoFocus />
      </FormField>

      {/* Both default to on, which is right for the ordinary case: a cancelled
          order is usually one the customer did not want, so the stock belongs
          back on the shelf and the money belongs back with them. */}
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="restock" defaultChecked />
        Return the items to stock
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="refund" defaultChecked />
        Refund anything paid
      </label>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Keep the order
        </Button>
        <Button type="submit" variant="destructive" disabled={busy}>
          {busy ? "Working…" : "Cancel order"}
        </Button>
      </div>
    </form>
  );
}
