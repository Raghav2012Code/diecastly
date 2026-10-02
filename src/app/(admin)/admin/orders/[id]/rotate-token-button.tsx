"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { rotateOrderAccessTokenAction } from "./rotate-token-actions";
import type { OrderChannel } from "@/lib/types/database.types";

/**
 * Rotate an order's guest access link.
 *
 * A leaked confirmation link keeps working until the token is replaced, so the
 * flow has an explicit confirmation step and ends by showing the new link for
 * copying — the token is returned exactly once and cannot be recovered from the
 * order page afterwards. The confirmation states the consequence plainly
 * ("the old link stops working") because an admin who rotates by accident has
 * no way to restore the old token, only to rotate again.
 *
 * Rendered only for online orders: an in-person sale has no guest link to leak,
 * so offering the control there would only produce a refusal.
 */
export function RotateTokenButton({
  orderId,
  orderNumber,
  channel,
}: {
  orderId: string;
  orderNumber: string;
  channel: OrderChannel;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [newLink, setNewLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  if (channel !== "online") return null;

  function close() {
    setOpen(false);
    setError(null);
    setNewLink(null);
    setCopied(false);
  }

  async function rotate() {
    setPending(true);
    setError(null);
    const result = await rotateOrderAccessTokenAction({ orderId });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      toast(result.error, "error");
      return;
    }

    setNewLink(
      `${window.location.origin}/order/${encodeURIComponent(result.data.orderNumber)}?token=${encodeURIComponent(result.data.accessToken)}`,
    );
    toast(`${orderNumber}: a new guest link was created. The old one no longer works.`, "success");
    router.refresh();
  }

  async function copy() {
    if (!newLink) return;
    try {
      await navigator.clipboard.writeText(newLink);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the value is shown in full below, so the
      // admin can still select and copy it by hand.
      setError("Copying was blocked by the browser. Select the link and copy it manually.");
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <RotateCcw className="h-4 w-4" />
        Rotate guest link
      </Button>

      <Modal
        open={open}
        onClose={close}
        size="sm"
        title={newLink ? "New guest link" : `Rotate the link for ${orderNumber}?`}
        description={
          newLink
            ? "Send this to the customer now. It is shown once and is not stored anywhere in the admin interface."
            : "This replaces the order's access token. The old link stops working immediately — anyone using it will see \"Order not found\"."
        }
        footer={
          newLink ? (
            <Button onClick={close}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void rotate()} disabled={pending}>
                {pending ? "Rotating…" : "Rotate link"}
              </Button>
            </>
          )
        }
      >
        {newLink ? (
          <div className="space-y-3">
            <Input value={newLink} readOnly onFocus={(event) => event.currentTarget.select()} />
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
                {copied ? <Check className="h-4 w-4" /> : null}
                {copied ? "Copied" : "Copy link"}
              </Button>
              {error ? (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            The customer&apos;s current link and anything it was sent to will no longer open this
            order.
          </p>
        )}
      </Modal>
    </>
  );
}
