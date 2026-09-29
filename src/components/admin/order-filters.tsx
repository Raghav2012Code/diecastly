import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  DERIVED_PAYMENT_STATUSES,
  ORDER_CHANNELS,
  ORDER_STATUSES,
} from "@/lib/types/database.types";
import { orderChannelLabel, orderStatusLabel, paymentStatusLabel } from "@/lib/display";

export type OrderFilterValues = {
  search?: string;
  status?: string;
  payment?: string;
  channel?: string;
  from?: string;
  to?: string;
};

/**
 * Orders filter bar.
 *
 * Every control carries a visible label (A6): the previous row used the
 * option text ("Any status", …) as the label, so a screen-reader user
 * landing mid-row could not tell which control was which. Fields are
 * grouped in a fieldset apart from the Apply/Clear actions.
 */
export function OrderFilters({ current }: { current: OrderFilterValues }) {
  return (
    <form method="get" className="space-y-3">
      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="sr-only">Filter orders</legend>
        <div className="sm:col-span-2 lg:col-span-1">
          <label htmlFor="order-search" className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Search orders
          </label>
          <Input
            id="order-search"
            name="search"
            type="search"
            defaultValue={current.search ?? ""}
            placeholder="Order number, name or phone"
          />
        </div>

        <div>
          <label htmlFor="order-status" className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Fulfilment status
          </label>
          <Select id="order-status" name="status" defaultValue={current.status ?? "all"}>
            <option value="all">Any status</option>
            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {orderStatusLabel[status]}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="order-payment" className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Payment status
          </label>
          <Select id="order-payment" name="payment" defaultValue={current.payment ?? "all"}>
            <option value="all">Any payment state</option>
            {DERIVED_PAYMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {paymentStatusLabel[status]}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="order-channel" className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Channel
          </label>
          <Select id="order-channel" name="channel" defaultValue={current.channel ?? "all"}>
            <option value="all">Any channel</option>
            {ORDER_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {orderChannelLabel[channel]}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="order-from" className="mb-1 block text-[11px] font-medium text-muted-foreground">
            From date
          </label>
          <Input id="order-from" name="from" type="date" defaultValue={current.from ?? ""} />
        </div>

        <div>
          <label htmlFor="order-to" className="mb-1 block text-[11px] font-medium text-muted-foreground">
            To date
          </label>
          <Input id="order-to" name="to" type="date" defaultValue={current.to ?? ""} />
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline">
          Apply
        </Button>
        <Link
          href="/admin/orders"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Clear
        </Link>
      </div>
    </form>
  );
}
