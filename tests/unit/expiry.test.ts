import { describe, expect, it, vi } from "vitest";
import { expiryState } from "@/lib/orders/expiry";

describe("expiryState", () => {
  const now = new Date("2026-09-26T12:00:00+05:30").getTime();

  it("is none without an expiry", () => {
    expect(expiryState(null, now)).toBe("none");
    expect(expiryState(undefined, now)).toBe("none");
  });

  it("is overdue past the deadline", () => {
    expect(expiryState("2026-09-26T11:59:59+05:30", now)).toBe("overdue");
  });

  it("is upcoming before the deadline", () => {
    expect(expiryState("2026-09-26T12:00:01+05:30", now)).toBe("upcoming");
  });

  it("does not throw on garbage", () => {
    expect(expiryState("not-a-date", now)).toBe("none");
  });

  it("defaults to the current time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00+05:30"));
    try {
      expect(expiryState("2026-09-26T11:00:00+05:30")).toBe("overdue");
      expect(expiryState("2026-09-26T13:00:00+05:30")).toBe("upcoming");
    } finally {
      vi.useRealTimers();
    }
  });
});
