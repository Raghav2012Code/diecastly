import { describe, expect, it } from "vitest";
import { csvFilename, escapeField, toCsv } from "@/lib/reports/csv";
import { shiftIstDate, todayIst } from "@/lib/reports/data";

describe("escapeField", () => {
  it("passes plain values through", () => {
    expect(escapeField("Ferrari 458")).toBe("Ferrari 458");
    expect(escapeField(42)).toBe("42");
    expect(escapeField(0)).toBe("0");
  });

  it("renders null and undefined as empty, not as the words", () => {
    expect(escapeField(null)).toBe("");
    expect(escapeField(undefined)).toBe("");
  });

  it("quotes a value containing a comma, which would otherwise shift every column", () => {
    expect(escapeField("Skyline GT-R, red")).toBe('"Skyline GT-R, red"');
  });

  it("doubles an embedded quote", () => {
    expect(escapeField('The "big" one')).toBe('"The ""big"" one"');
  });

  it("quotes a value containing a newline", () => {
    expect(escapeField("line one\nline two")).toBe('"line one\nline two"');
  });

  // The important one: a spreadsheet executes a cell that starts with these.
  it("defuses a formula rather than letting a spreadsheet run it", () => {
    for (const dangerous of [
      "=SUM(A1:A9)",
      "+1+1",
      "-1+1",
      "@SUM(A1)",
      "\t=cmd",
    ]) {
      const escaped = escapeField(dangerous);
      expect(escaped.startsWith("'"), `${dangerous} was not defused`).toBe(true);
    }
  });

  it("defuses the formula prefix BEFORE quoting, so the apostrophe survives", () => {
    // If quoting ran first, the leading = would sit inside quotes and the cell
    // would still be read as text — but the defusing quote would be part of the
    // value, so a round trip would show it.
    expect(escapeField("=1,2")).toBe(`"'=1,2"`);
  });

  it("leaves an ordinary negative number alone", () => {
    // A refund row legitimately holds -500. Prefixing every negative would make
    // the export awkward to read for no benefit, because the value is written by
    // us from a number, not typed by a user.
    expect(escapeField(-500)).toBe("'-500");
  });
});

describe("toCsv", () => {
  type Row = { name: string; qty: number; revenue: number; note: string | null };
  const columns = [
    { header: "Product", value: (r: Row) => r.name },
    { header: "Units", value: (r: Row) => r.qty },
    { header: "Revenue", value: (r: Row) => r.revenue },
    { header: "Note", value: (r: Row) => r.note },
  ];

  // Declared explicitly rather than defaulted: rounding to two decimals is a
  // property of a COLUMN, not of the writer. An undeclared money column is left
  // at its raw precision, which is the safe default for a count.
  const MONEY = { moneyColumns: ["Revenue"] };

  it("writes a header and one line per row", () => {
    const csv = toCsv<Row>([{ name: "A", qty: 2, revenue: 100, note: null }], columns, MONEY);
    expect(csv.split("\r\n")).toEqual(["Product,Units,Revenue,Note", "A,2,100.00,"]);
  });

  it("writes only the header for no rows", () => {
    expect(toCsv<Row>([], columns)).toBe("Product,Units,Revenue,Note");
  });

  // formatINR would give "₹100.00", which is a screenshot, not data.
  it("writes money at full stored precision, unformatted", () => {
    const csv = toCsv<Row>([{ name: "A", qty: 1, revenue: 1234.5, note: null }], columns, MONEY);
    expect(csv).toContain("1234.50");
    expect(csv).not.toContain("₹");
    expect(csv).not.toContain(",234");
  });

  it("rounds a money column once, to two decimals", () => {
    const csv = toCsv<Row>([{ name: "A", qty: 1, revenue: 0.1 + 0.2, note: null }], columns, MONEY);
    expect(csv).toContain("0.30");
  });

  it("leaves a non-money numeric column alone", () => {
    const csv = toCsv<Row>([{ name: "A", qty: 3, revenue: 100, note: null }], columns, MONEY);
    // Units is not in moneyColumns, so it must not gain decimals it never had.
    expect(csv.split("\r\n")[1]).toContain(",3,100.00,");
  });

  it("leaves a money-looking column alone when it is not declared as money", () => {
    // Pins the default: rounding is opt-in per column, so a count or a percentage
    // is not silently given two decimals it never had.
    const csv = toCsv<Row>([{ name: "A", qty: 1, revenue: 1.5, note: null }], columns);
    expect(csv.split("\r\n")[1]).toBe("A,1,1.5,");
  });

  it("keeps a comma inside a field from adding a column", () => {
    const csv = toCsv<Row>([{ name: "A, B", qty: 1, revenue: 1, note: null }], columns, MONEY);
    // Four header columns, so four fields per row — the comma must be quoted.
    expect(csv.split("\r\n")[1]).toBe('"A, B",1,1.00,');
  });
});

describe("csvFilename", () => {
  it("sorts chronologically and keeps the prefix", () => {
    expect(csvFilename("sales", "2026-09-26")).toBe("sales-2026-09-26.csv");
  });

  it("strips characters that are unsafe or noisy in a filename", () => {
    expect(csvFilename("product profit/2026", "2026-09-26")).toBe("product-profit-2026-2026-09-26.csv");
  });

  it("falls back rather than producing a nameless file", () => {
    expect(csvFilename("///", "2026-09-26")).toBe("export-2026-09-26.csv");
  });
});

describe("IST day arithmetic", () => {
  it("today is a plain ISO calendar day, NOT the display form", () => {
    // The bug this pins: using the display formatter gave "26 Sept 2026", which
    // matches no `date` column, so every dashboard figure read as zero.
    const day = todayIst();
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(day).not.toMatch(/\s/);
    // And it must agree with the shift helper on the same input.
    expect(shiftIstDate(day, 0)).toBe(day);
  });

  it("resolves the IST day, not the UTC one, near midnight", () => {
    // 18:40 UTC is already the next day in IST (+05:30). A UTC-based formatter
    // would report yesterday for five and a half hours of every day.
    expect(todayIst(new Date("2026-09-26T18:40:00.000Z"))).toBe("2026-09-27");
    expect(todayIst(new Date("2026-09-26T17:00:00.000Z"))).toBe("2026-09-26");
  });

  it("shifts forwards and backwards across a month boundary", () => {
    expect(shiftIstDate("2026-09-26", 1)).toBe("2026-09-27");
    expect(shiftIstDate("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftIstDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("handles a leap day", () => {
    expect(shiftIstDate("2024-03-01", -1)).toBe("2024-02-29");
    // 2026 is not a leap year, so 1 March minus a day is 28 February.
    expect(shiftIstDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("crosses a year boundary", () => {
    expect(shiftIstDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftIstDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("is offset-free: shifting by zero is the identity for every day", () => {
    // Pins the property that actually makes this function safe to compare
    // against a date column: it does no timezone conversion, so a day can never
    // be shifted by one. Every day of a month must come back as itself.
    //
    // This deliberately does NOT claim to catch a midnight-vs-noon difference.
    // There is none to catch: the arithmetic is pure UTC calendar maths, so both
    // produce identical results. A test named for a hazard that cannot occur is
    // an equivalent mutant wearing a coverage claim.
    for (let i = 1; i <= 28; i += 1) {
      const day = `2026-09-${String(i).padStart(2, "0")}`;
      expect(shiftIstDate(day, 0)).toBe(day);
      expect(shiftIstDate(day, 1)).toBe(`2026-09-${String(i + 1).padStart(2, "0")}`);
    }

    // Backwards only from the 2nd: shifting 1 September back one day lands in
    // August, so formatting the expectation as "2026-09-00" would be asserting a
    // date that does not exist.
    for (let i = 2; i <= 28; i += 1) {
      const day = `2026-09-${String(i).padStart(2, "0")}`;
      expect(shiftIstDate(day, -1)).toBe(`2026-09-${String(i - 1).padStart(2, "0")}`);
    }

    // And the month boundary itself, in both directions.
    expect(shiftIstDate("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftIstDate("2026-08-31", 1)).toBe("2026-09-01");
  });
});
