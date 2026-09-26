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

  it("rejects a well-formed date that does not exist", () => {
    // The old check validated SHAPE only. V8 range-checks the month and rejects a
    // day above 31, but silently rolls an over-large day within a valid month into
    // the neighbour -- and not always the same way: 30 February became 2 March
    // while 31 April became 30 April. So ?from=2026-02-30 rendered a control
    // reading 30 February while filtering from a different day, silently.
    expect(istDayBoundary("2026-02-30")).toBeNull();
    expect(istDayBoundary("2026-04-31")).toBeNull();
    expect(istDayBoundary("2026-04-31", true)).toBeNull();
    expect(istDayBoundary("2026-06-31")).toBeNull();
    expect(istDayBoundary("2024-02-30")).toBeNull(); // 2024 IS a leap year
  });

  it("still accepts a real leap day", () => {
    // The control for the test above. A fix that simply rejected day > 28 would
    // pass the first test and break this one.
    //
    // The result is the 28th in UTC because IST midnight is 18:30 the previous
    // day -- that is correct, not a bug.
    expect(istDayBoundary("2024-02-29")).toBe("2024-02-28T18:30:00.000Z");
  });

  it("accepts the last day of every month", () => {
    for (const [month, last] of [
      ["01", "31"],
      ["02", "28"],
      ["03", "31"],
      ["04", "30"],
      ["05", "31"],
      ["06", "30"],
      ["07", "31"],
      ["08", "31"],
      ["09", "30"],
      ["10", "31"],
      ["11", "30"],
      ["12", "31"],
    ] as const) {
      expect(istDayBoundary(`2026-${month}-${last}`)).not.toBeNull();
      expect(istDayBoundary(`2026-${month}-${String(Number(last) + 1).padStart(2, "0")}`)).toBeNull();
    }
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
