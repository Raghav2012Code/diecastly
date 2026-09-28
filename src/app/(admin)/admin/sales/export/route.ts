import { NextResponse } from "next/server";
import { getSalesSeries, getSalesTotals, shiftIstDate, todayIst } from "@/lib/reports/data";
import { csvFilename, toCsv } from "@/lib/reports/csv";

/**
 * Daily sales as CSV.
 *
 * A route handler rather than a server action, because the response is a file
 * download: a redirect-then-download is a worse experience than a direct link,
 * and a plain `<a href>` to this route is bookmarkable and shareable.
 *
 * Admin-only by construction. The route runs in the admin segment, and
 * `middleware.ts` guards `/admin/*`, so an unauthenticated request is redirected
 * to the login before it reaches here. The data it reads comes from
 * `security_invoker` reporting views, so RLS applies on top of that.
 *
 * Money is written unformatted at full stored precision (see `lib/reports/csv.ts`)
 * so the file can be re-imported and reconciled. A "₹1,234.00" column is a
 * screenshot, not data.
 */
export const dynamic = "force-dynamic";

function pick(value: string | null, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const today = todayIst();
  const toDay = pick(url.searchParams.get("to"), today);
  const fromDay = pick(url.searchParams.get("from"), shiftIstDate(toDay, -29));

  const [totals, series] = await Promise.all([getSalesTotals(fromDay, toDay), getSalesSeries(fromDay, toDay)]);

  // A failed read returns a plain-text error rather than a CSV of nothing. An
  // empty file that opens cleanly is the worst possible outcome: it looks like a
  // real answer.
  if (!totals.ok || !series.ok) {
    return new NextResponse("The report could not be generated. Please try again.\n", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const t = totals.data;

  const csv = toCsv(
    series.data,
    [
      { header: "Date", value: (row) => row.day },
      { header: "Orders", value: (row) => row.orders },
      { header: "Units", value: (row) => row.units },
      { header: "Revenue", value: (row) => row.revenue },
      { header: "Gross profit", value: (row) => row.grossProfit },
    ],
    { generatedOn: today, moneyColumns: ["Revenue", "Gross profit"] },
  );

  // A totals row, so the file reconciles without the reader having to sum it.
  // A leading blank-ish label keeps it distinguishable from a data row.
  //
  // Built through the same `toCsv`/`escapeField` path as every other field rather
  // than hand-joined. A hand-joined row skipped the formula defusal, and a
  // negative gross profit emits "-123.45" — a leading "-", which is exactly the
  // character class `FORMULA_START` exists to neutralise. Money also went out
  // through `toFixed` instead of `roundMoney`.
  const totalsRow = toCsv(
    [
      {
        label: `TOTAL ${fromDay} to ${toDay}`,
        orders: t.ordersCount,
        units: t.unitsSold,
        revenue: t.revenue,
        grossProfit: t.grossProfit,
      },
    ],
    [
      { header: "Date", value: (row) => row.label },
      { header: "Orders", value: (row) => row.orders },
      { header: "Units", value: (row) => row.units },
      { header: "Revenue", value: (row) => row.revenue },
      { header: "Gross profit", value: (row) => row.grossProfit },
    ],
    { moneyColumns: ["Revenue", "Gross profit"] },
  )
    // `toCsv` always emits a header; the totals row must not repeat it.
    .split("\r\n")
    .slice(1)
    .join("\r\n");

// A leading BOM. Without it Excel opens the file in the local code page and
// mangles any non-ASCII character in a product or customer name, which for a
// CSV full of names is real corruption rather than a cosmetic problem.
// Harmless to every other reader.
  const body = `\uFEFF${csv}\r\n${totalsRow}\r\n`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${csvFilename("sales", today)}"`,
      "cache-control": "no-store",
    },
  });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

