import { NextResponse } from "next/server";
import { getProductProfit, todayIst } from "@/lib/reports/data";
import { csvFilename, toCsv } from "@/lib/reports/csv";

/**
 * Product performance as CSV.
 *
 * A route handler so the download is a plain link — bookmarkable, shareable, and
 * no redirect in the middle of a file download.
 *
 * Admin-only by construction: the route lives under the admin segment and
 * `middleware.ts` guards `/admin/*`, so an unauthenticated request never reaches
 * it. The data comes from a `security_invoker` view, so RLS applies on top.
 *
 * The margin column is computed here rather than exported as a raw ratio,
 * because a percentage written as a fraction (0.42 rather than 42) is the single
 * most common way a spreadsheet export gets misread.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const today = todayIst();
  const profit = await getProductProfit(500);

  if (!profit.ok) {
    return new NextResponse("The report could not be generated. Please try again.\n", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const rows = profit.data.map((row) => ({
    ...row,
    margin: row.item_revenue > 0 ? (row.gross_profit / row.item_revenue) * 100 : null,
  }));

  const csv = toCsv(
    rows,
    [
      { header: "Product", value: (row) => row.product_name },
      { header: "Units sold", value: (row) => row.units_sold },
      { header: "Revenue", value: (row) => row.item_revenue },
      { header: "Cost of goods", value: (row) => row.cogs },
      { header: "Gross profit", value: (row) => row.gross_profit },
      { header: "Margin %", value: (row) => row.margin },
    ],
    { generatedOn: today, moneyColumns: ["Revenue", "Cost of goods", "Gross profit"] },
  );

  return new NextResponse(`\uFEFF${csv}\r\n`, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${csvFilename("product-profit", today)}"`,
      "cache-control": "no-store",
    },
  });
}
