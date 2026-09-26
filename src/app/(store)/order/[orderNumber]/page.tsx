import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAnonClient } from "@/lib/supabase/server";
import { getOrderByAccess } from "@/lib/db/rpc";
import { getPublicSettings } from "@/lib/store/data";
import { formatINR } from "@/lib/validation/money";
import { formatDateTimeIST } from "@/lib/dates";
import { productImageUrl } from "@/lib/storage";
import { OrderStatusBadge } from "@/components/store/order-status-badge";

type Params = Promise<{ orderNumber: string }>;
type SearchParams = Promise<{ token?: string | string[] }>;

export const metadata: Metadata = { title: "Your order" };

/**
 * Guest order confirmation and status.
 *
 * Access needs BOTH the order number and the access token
 * (`get_order_by_access`, docs/security.md §6). The token is a 122-bit uuid
 * generated at order creation and returned exactly once, by
 * `place_online_order`. Phone and email are linking keys and never authorise
 * anything, so there is deliberately no "look up my order" form here.
 *
 * A missing or wrong token gets the same page as a non-existent order, so the
 * response reveals nothing about which order numbers are real. That is why this
 * calls notFound() rather than rendering "wrong token" — a distinct message is a
 * probe for guessing order numbers.
 *
 * Everything shown is the database's word, not the cart's. A pending order past
 * its `expires_at` is still rendered as pending: the store only cancels it when
 * an admin does, and the page must never imply otherwise (ux.md §11).
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { orderNumber } = await params;
  const { token } = await searchParams;
  const accessToken = Array.isArray(token) ? token[0] : token;

  // No token, or a malformed one, is treated exactly like a wrong one.
  const uuid =
    typeof accessToken === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accessToken)
      ? accessToken
      : null;

  if (!uuid) notFound();

  const supabase = createAnonClient();
  const result = await getOrderByAccess(supabase, {
    orderNumber: decodeURIComponent(orderNumber),
    accessToken: uuid,
  });

  // A read failure is a server error, not a 404: reporting "not found" because
  // the database was briefly unreachable would be a lie about the order.
  if (!result.ok) throw new Error(result.error.message);

  const data = result.data as {
    found?: boolean;
    order_number?: string;
    status?: string;
    channel?: string;
    created_at?: string;
    customer_name?: string;
    payment_method?: string;
    subtotal?: number;
    shipping_fee?: number;
    total?: number;
    expires_at?: string | null;
    courier?: string | null;
    tracking_number?: string | null;
    items?: { name: string; quantity: number; unit_price: number; line_total: number }[];
  };

  if (!data.found) notFound();

  const settings = await getPublicSettings();
  const items = data.items ?? [];
  const method = data.payment_method === "cod" ? "cod" : "upi";

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-6 space-y-2">
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Order placed
        </p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Thank you{data.customer_name ? `, ${data.customer_name}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          Order <span className="font-medium text-foreground">{data.order_number}</span>
          {data.created_at ? ` · placed ${formatDateTimeIST(data.created_at)}` : null}
        </p>
        <div className="pt-1">
          <OrderStatusBadge status={data.status ?? "pending"} />
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-card px-4 py-3">
        <h2 className="text-sm font-semibold">How to pay</h2>
        {method === "cod" ? (
          <p className="text-sm text-muted-foreground">
            Pay the courier when the parcel arrives. Nothing more to do now.
          </p>
        ) : (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Pay <span className="font-medium text-foreground">{formatINR(data.total ?? 0)}</span> to{" "}
              {settings.upi_id ? (
                <span className="font-medium text-foreground">{settings.upi_id}</span>
              ) : (
                settings.business_name
              )}
              , then send us the screenshot. We will confirm once we see it.
            </p>
            {settings.upi_qr_path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={productImageUrl(settings.upi_qr_path) ?? ""}
                alt={`UPI QR code for ${settings.business_name}`}
                width={180}
                height={180}
                className="rounded-md border border-border bg-background"
              />
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <caption className="sr-only">Items in this order</caption>
          <thead className="border-b border-border bg-secondary/40 text-left">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Item
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Qty
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item, index) => (
              <tr key={`${item.name}-${index}`}>
                <td className="px-4 py-2">{item.name}</td>
                <td className="px-4 py-2 text-right tabular-nums">{item.quantity}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatINR(item.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="mt-4 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="tabular-nums">{formatINR(data.subtotal ?? 0)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Shipping</dt>
          <dd className="tabular-nums">
            {(data.shipping_fee ?? 0) > 0 ? formatINR(data.shipping_fee ?? 0) : "Free"}
          </dd>
        </div>
        <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatINR(data.total ?? 0)}</dd>
        </div>
      </dl>

      {data.courier || data.tracking_number ? (
        <div className="mt-6 space-y-1 rounded-lg border border-border px-4 py-3 text-sm">
          <h2 className="font-semibold">Shipment</h2>
          {data.courier ? (
            <p className="text-muted-foreground">
              Courier: <span className="text-foreground">{data.courier}</span>
            </p>
          ) : null}
          {data.tracking_number ? (
            <p className="text-muted-foreground">
              Tracking: <span className="text-foreground">{data.tracking_number}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="mt-6 text-xs text-muted-foreground">
        Keep this link. It is the only way to view this order — there is no account, and we
        cannot look it up from your phone number. Bookmark it now.
      </p>
    </div>
  );
}
