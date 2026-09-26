import { describe, expect, it } from "vitest";
import { formatDateIST, formatDateTimeIST, istDayBoundary } from "@/lib/dates";

describe("istDayBoundary", () => {
  it("returns the UTC instant of the start of an IST day", () => {
    // IST is UTC+05:30 with no daylight saving, so midnight local is 18:30 the
    // previous day in UTC.
    expect(istDayBoundary("2026-09-26")).toBe("2026-09-25T18:30:00.000Z");
  });

  it("returns the last instant of an IST day for the end of day", () => {
    expect(istDayBoundary("2026-09-26", true)).toBe("2026-09-26T18:29:59.999Z");
  });

  it("spans exactly one IST day", () => {
    const start = Date.parse(istDayBoundary("2026-03-15") as string);
    const end = Date.parse(istDayBoundary("2026-03-15", true) as string);
    expect(end - start).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it("ignores anything that is not a plain date, so a bad parameter is dropped", () => {
    expect(istDayBoundary("")).toBeNull();
    expect(istDayBoundary("2026-9-26")).toBeNull();
    expect(istDayBoundary("26-09-2026")).toBeNull();
    expect(istDayBoundary("2026-09-26T10:00:00Z")).toBeNull();
    expect(istDayBoundary("not-a-date")).toBeNull();
  });
});

describe("IST formatting", () => {
  it("renders a UTC instant as an IST calendar date", () => {
    // 18:30 UTC on the 25th is already the 26th in IST.
    expect(formatDateIST("2026-09-25T18:30:00.000Z")).toContain("26");
  });

  it("renders a UTC instant as IST wall-clock time", () => {
    const formatted = formatDateTimeIST("2026-09-26T09:15:00.000Z");
    expect(formatted).toMatch(/2026/);
  });
});
