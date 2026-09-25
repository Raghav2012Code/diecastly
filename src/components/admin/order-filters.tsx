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

export function OrderFilters({ current }: { current: OrderFilterValues }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      <div className="min-w-56 flex-1">
        <label htmlFor="order-search" className="sr-only">
          Search orders
        </label>
        <Input
          id="order-search"
          name="search"
          type="search"
          defaultValue={current.search ?? ""}
          placeholder="Search order number, name or phone"
        />
      </div>

      <div>
        <label htmlFor="order-status" className="sr-only">
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
        <label htmlFor="order-payment" className="sr-only">
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
        <label htmlFor="order-channel" className="sr-only">
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
        <label htmlFor="order-from" className="sr-only">
          From date
        </label>
        <Input id="order-from" name="from" type="date" defaultValue={current.from ?? ""} aria-label="From date" />
      </div>

      <div>
        <label htmlFor="order-to" className="sr-only">
          To date
        </label>
        <Input id="order-to" name="to" type="date" defaultValue={current.to ?? ""} aria-label="To date" />
      </div>

      <div className="flex items-center gap-2">
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
