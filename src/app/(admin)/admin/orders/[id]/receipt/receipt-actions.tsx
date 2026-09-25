"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Receipt toolbar. Hidden when printing so the sheet is clean. `autoPrint`
 * (from `?print=1`) fires the browser print dialog once, so a link from order
 * detail or the till prints without a second click.
 */
export function ReceiptActions({
  orderId,
  autoPrint,
}: {
  orderId: string;
  autoPrint: boolean;
}) {
  useEffect(() => {
    if (!autoPrint) return;
    const handle = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(handle);
  }, [autoPrint]);

  return (
    <div className="no-print flex items-center justify-between gap-3">
      <Link
        href={`/admin/orders/${orderId}`}
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to order
      </Link>
      <Button size="sm" onClick={() => window.print()}>
        <Printer className="h-4 w-4" />
        Print
      </Button>
    </div>
  );
}
