import { describe, expect, it } from "vitest";
import {
  advanceOrderSchema,
  canCancel,
  cancelOrderSchema,
  isFulfilmentLocked,
  nextStatus,
  nextStatusLabel,
} from "@/lib/validation/fulfilment";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/types/database.types";

const UUID = "11111111-1111-1111-1111-111111111111";

/**
 * The transition map mirrors `update_order_status` in SQL. These tests pin the
 * mirror, because the UI offers exactly one forward action derived from it and a
 * wrong mirror means either a dead button or an action the RPC will refuse.
 */
describe("nextStatus", () => {
  it("follows the linear chain in SQL", () => {
    expect(nextStatus("pending")).toBe("confirmed");
    expect(nextStatus("confirmed")).toBe("packed");
    expect(nextStatus("packed")).toBe("shipped");
    expect(nextStatus("shipped")).toBe("delivered");
    expect(nextStatus("delivered")).toBe("completed");
  });

  it("has no successor at the end of the chain", () => {
    expect(nextStatus("completed")).toBeNull();
  });

  // cancelled and returned are refused by the RPC and routed to cancel_order.
  it("offers no forward step out of a terminal status", () => {
    expect(nextStatus("cancelled")).toBeNull();
    expect(nextStatus("returned")).toBeNull();
  });

  it("never offers cancelled or returned as a target", () => {
    for (const status of ORDER_STATUSES) {
      const next = nextStatus(status);
      if (next !== null) {
        expect(next).not.toBe("cancelled");
        expect(next).not.toBe("returned");
      }
    }
  });

  it("is total: every declared status has an answer", () => {
    for (const status of ORDER_STATUSES) {
      const result = nextStatus(status);
      expect(result === null || ORDER_STATUSES.includes(result)).toBe(true);
    }
  });

  it("labels every step it offers", () => {
    for (const status of ORDER_STATUSES) {
      const next = nextStatus(status);
      if (next !== null) {
        const label = nextStatusLabel(status);
        expect(label, `no label for ${status}`).toBeTruthy();
        expect(label).not.toContain("_");
      }
    }
  });
});

describe("canCancel", () => {
  it("allows cancelling anything not yet shipped", () => {
    expect(canCancel("pending", "online")).toBe(true);
    expect(canCancel("confirmed", "online")).toBe(true);
    expect(canCancel("packed", "online")).toBe(true);
  });

  it("allows reversing a completed in-person sale", () => {
    expect(canCancel("completed", "in_person")).toBe(true);
  });

  // A completed ONLINE sale is not reversible through cancel_order.
  it("does not allow reversing a completed online sale", () => {
    expect(canCancel("completed", "online")).toBe(false);
  });

  it("does not allow cancelling anything already shipped or later", () => {
    for (const status of ["shipped", "delivered", "cancelled", "returned"] as OrderStatus[]) {
      expect(canCancel(status, "online")).toBe(false);
      expect(canCancel(status, "in_person")).toBe(false);
    }
  });
});

describe("isFulfilmentLocked", () => {
  it("locks the order once it has left the warehouse", () => {
    expect(isFulfilmentLocked("shipped")).toBe(true);
    expect(isFulfilmentLocked("delivered")).toBe(true);
    expect(isFulfilmentLocked("cancelled")).toBe(true);
    expect(isFulfilmentLocked("returned")).toBe(true);
  });

  it("leaves a pre-shipment order editable", () => {
    expect(isFulfilmentLocked("pending")).toBe(false);
    expect(isFulfilmentLocked("confirmed")).toBe(false);
    expect(isFulfilmentLocked("packed")).toBe(false);
  });
});

describe("advanceOrderSchema", () => {
  it("accepts a legal forward step", () => {
    const parsed = advanceOrderSchema.safeParse({ orderId: UUID, newStatus: "confirmed" });
    expect(parsed.success).toBe(true);
  });

  // The SQL raises use_cancel_order for both, so the form must not offer them.
  it("refuses cancelled and returned as a target", () => {
    expect(advanceOrderSchema.safeParse({ orderId: UUID, newStatus: "cancelled" }).success).toBe(false);
    expect(advanceOrderSchema.safeParse({ orderId: UUID, newStatus: "returned" }).success).toBe(false);
  });

  it("refuses a nonsense status and a non-uuid order", () => {
    expect(advanceOrderSchema.safeParse({ orderId: UUID, newStatus: "teleported" }).success).toBe(false);
    expect(advanceOrderSchema.safeParse({ orderId: "nope", newStatus: "confirmed" }).success).toBe(false);
  });

  it("caps the optional fields so a long note cannot be sent", () => {
    expect(
      advanceOrderSchema.safeParse({ orderId: UUID, newStatus: "confirmed", note: "x".repeat(501) })
        .success,
    ).toBe(false);
    expect(
      advanceOrderSchema.safeParse({ orderId: UUID, newStatus: "shipped", tracking: "x".repeat(200) })
        .success,
    ).toBe(false);
  });
});

describe("cancelOrderSchema", () => {
  it("requires a reason, because it goes on the order's history", () => {
    expect(cancelOrderSchema.safeParse({ orderId: UUID, reason: "" }).success).toBe(false);
    expect(cancelOrderSchema.safeParse({ orderId: UUID, reason: "ab" }).success).toBe(false);
    expect(cancelOrderSchema.safeParse({ orderId: UUID, reason: "customer asked" }).success).toBe(true);
  });

  it("caps the reason length", () => {
    expect(
      cancelOrderSchema.safeParse({ orderId: UUID, reason: "x".repeat(301) }).success,
    ).toBe(false);
  });

  // A cancelled order is usually one the customer did not want, so both default on.
  it("defaults to restocking and refunding", () => {
    const parsed = cancelOrderSchema.parse({ orderId: UUID, reason: "customer asked" });
    expect(parsed.restock).toBe(true);
    expect(parsed.refund).toBe(true);
  });
});
