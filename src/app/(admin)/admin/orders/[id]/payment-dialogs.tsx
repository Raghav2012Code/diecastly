"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { PAYMENT_METHODS, recordPaymentSchema, refundPaymentSchema } from "@/lib/validation/order";
import { paymentMethodLabel, paymentStatusLabel } from "@/lib/display";
import { newIdempotencyKey } from "@/lib/utils";
import type { PaymentMethod } from "@/lib/types/database.types";
import { recordPaymentAction, refundPaymentAction } from "../actions";

/**
 * Record a payment or a refund. Both only append to the payments ledger — the
 * RPCs never change fulfilment status. Amounts are re-validated and capped
 * server-side; the client guards are convenience only.
 */
export function PaymentDialogs({
  orderId,
  balance,
  netPaid,
  defaultMethod,
}: {
  orderId: string;
  balance: number;
  netPaid: number;
  defaultMethod: PaymentMethod;
}) {
  const [mode, setMode] = useState<"payment" | "refund" | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>(defaultMethod);
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const keyRef = useRef("");
  const { toast } = useToast();
  const router = useRouter();

  function open(next: "payment" | "refund") {
    keyRef.current = newIdempotencyKey();
    setAmount(next === "payment" ? (balance > 0 ? balance.toFixed(2) : "") : netPaid > 0 ? netPaid.toFixed(2) : "");
    setMethod(defaultMethod);
    setReference("");
    setError(null);
    setMode(next);
  }

  function submit() {
    if (!mode) return;
    const numeric = amount.trim() === "" ? Number.NaN : Number(amount);
    const key = keyRef.current;

    const parsed =
      mode === "payment"
        ? recordPaymentSchema.safeParse({
            orderId,
            amount: numeric,
            method,
            reference: reference.trim() || undefined,
            idempotencyKey: key,
          })
        : refundPaymentSchema.safeParse({
            orderId,
            amount: numeric,
            method,
            reason: reference.trim() || undefined,
            idempotencyKey: key,
          });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid amount.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result =
        mode === "payment" ? await recordPaymentAction(parsed.data) : await refundPaymentAction(parsed.data);
      if (result.ok) {
        toast(
          mode === "payment"
            ? `Payment recorded — ${paymentStatusLabel[result.data.paymentStatus]}`
            : `Refund recorded — ${paymentStatusLabel[result.data.paymentStatus]}`,
          "success",
        );
        setMode(null);
        router.refresh();
      } else {
        setError(result.error);
        toast(result.error, "error");
      }
    });
  }

  const isPayment = mode === "payment";

  return (
    <>
      <Button variant="outline" onClick={() => open("payment")} disabled={balance <= 0}>
        Record payment
      </Button>
      <Button variant="outline" onClick={() => open("refund")} disabled={netPaid <= 0}>
        Record refund
      </Button>

      <Modal
        open={mode !== null}
        onClose={() => setMode(null)}
        size="sm"
        title={isPayment ? "Record payment" : "Record refund"}
        description={
          isPayment
            ? "Appends a received payment to the ledger. Fulfilment status is not changed."
            : "Appends a compensating refund. Original payments are never edited."
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setMode(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : isPayment ? "Record payment" : "Record refund"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField
            label="Amount"
            htmlFor="payment-amount"
            required
            error={error}
            hint={isPayment ? `Outstanding balance ${balance.toFixed(2)}` : undefined}
          >
            <Input
              id="payment-amount"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="tnum"
              autoFocus
              aria-invalid={Boolean(error)}
            />
          </FormField>

          <FormField label="Method" htmlFor="payment-method">
            <Select
              id="payment-method"
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            >
              {PAYMENT_METHODS.map((option) => (
                <option key={option} value={option}>
                  {paymentMethodLabel[option]}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label={isPayment ? "Reference" : "Reason"} htmlFor="payment-reference">
            <Input
              id="payment-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder={isPayment ? "Optional, e.g. UPI reference" : "Optional, e.g. damaged box"}
            />
          </FormField>
        </div>
      </Modal>
    </>
  );
}
