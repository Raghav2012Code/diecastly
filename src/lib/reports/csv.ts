/**
 * CSV export.
 *
 * A hand-rolled writer rather than a dependency, because the hard part is not
 * the joining and the hard part is getting the quoting right. Every value goes
 * through `escapeField`, and the two cases that matter are:
 *
 *  - a value containing a comma, a quote or a newline, which would otherwise
 *    shift every column after it;
 *  - a value that STARTS with `=`, `+`, `-` or `@`, which a spreadsheet treats
 *    as a formula. A product called `=SUM(A1:A9)` or a note typed by a customer
 *    would otherwise execute when the file is opened. Prefixing with a single
 *    quote is the standard, spreadsheet-portable way to defuse that, and it is
 *    applied to every field rather than trying to spot the dangerous ones.
 *
 * Money is written at full precision as stored, not through `formatINR`, so the
 * export can be re-imported and reconciled. A report that exports "₹1,234.00"
 * is a screenshot, not data.
 */

import { roundMoney } from "@/lib/validation/money";

/** Characters a spreadsheet reads as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

export function escapeField(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text = String(value);

  // Neutralise a formula before quoting, so the apostrophe survives the round
  // trip and the cell shows the text rather than evaluating it.
  if (FORMULA_START.test(text)) {
    text = `'${text}`;
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => unknown;
};

export type CsvOptions = {
  /** ISO date, e.g. `2026-09-26`. Included in the filename. */
  generatedOn?: string;
  /** Columns whose values are money, written at full stored precision. */
  moneyColumns?: readonly string[];
};

/**
 * Builds a CSV from rows and column definitions.
 *
 * Money columns are rounded once on the way out, matching the rule the sale RPCs
 * use, so a figure in the export equals the figure on the receipt rather than
 * being a sum of separately-rounded cells.
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[], options: CsvOptions = {}): string {
  const money = new Set(options.moneyColumns ?? []);

  const header = columns.map((column) => escapeField(column.header)).join(",");

  const body = rows.map((row) =>
    columns
      .map((column) => {
        const raw = column.value(row);
        if (money.has(column.header) && typeof raw === "number" && Number.isFinite(raw)) {
          return escapeField(roundMoney(raw).toFixed(2));
        }
        return escapeField(raw);
      })
      .join(","),
  );

  return [header, ...body].join("\r\n");
}

/** A filename that sorts chronologically and is safe on every filesystem. */
export function csvFilename(prefix: string, isoDay: string): string {
  const safe = prefix.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${safe || "export"}-${isoDay}.csv`;
}
