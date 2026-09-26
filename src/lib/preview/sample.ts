import type {
  OrderDetail,
  OrderItemRow,
  OrderRow,
  OrderStatusHistoryRow,
  PaymentRow,
  SellableProduct,
  SettingsRow,
  VOrderSummaryRow,
} from "@/lib/types/database.types";
import { businessSummary, type ReceiptBusiness } from "@/lib/orders/receipt";
import { lineProfit, lineTotal } from "@/lib/validation/money";

/**
 * Sample data for the frontend preview harness (`/preview`). Not used by the
 * app at runtime — it exists so the UI can be reviewed without the Supabase
 * stack. Deliberately real diecast content, not lorem ipsum.
 */

const TOKEN = "00000000-0000-0000-0000-000000000000";

function orderRow(
  overrides: Partial<OrderRow> & Pick<OrderRow, "id" | "order_number" | "channel" | "status" | "created_at">,
): OrderRow {
  return {
    customer_id: null,
    customer_name: null,
    customer_phone: null,
    customer_email: null,
    shipping_address: null,
    payment_method: null,
    shipping_fee: 0,
    shipping_cost: 0,
    courier: null,
    tracking_number: null,
    shipped_at: null,
    delivered_at: null,
    subtotal: 0,
    discount_total: 0,
    total: 0,
    cost_total: 0,
    access_token: TOKEN,
    expires_at: null,
    idempotency_key: null,
    notes: null,
    created_by: null,
    cancel_reason: null,
    cancelled_at: null,
    updated_at: overrides.created_at,
    ...overrides,
  };
}

function item(
  id: string,
  orderId: string,
  overrides: Partial<OrderItemRow> & Pick<OrderItemRow, "product_name" | "quantity" | "unit_price" | "unit_cost">,
): OrderItemRow {
  const quantity = overrides.quantity;
  const unitPrice = overrides.unit_price;
  const unitCost = overrides.unit_cost;
  const discount = overrides.line_discount ?? 0;
  const createdAt = overrides.created_at ?? "2026-09-26T09:15:00+05:30";
  return {
    id,
    order_id: orderId,
    product_id: overrides.product_id ?? null,
    product_name: overrides.product_name,
    sku: overrides.sku ?? null,
    quantity,
    unit_price: unitPrice,
    unit_cost: unitCost,
    line_discount: discount,
    line_total: lineTotal(unitPrice, quantity, discount),
    line_profit: lineProfit(unitPrice, unitCost, quantity, discount),
    created_at: createdAt,
  };
}

function payment(
  id: string,
  orderId: string,
  overrides: Partial<PaymentRow> & Pick<PaymentRow, "amount" | "method" | "status">,
): PaymentRow {
  const at = overrides.received_at ?? "2026-09-26T09:15:00+05:30";
  return {
    id,
    order_id: orderId,
    amount: overrides.amount,
    method: overrides.method,
    provider: overrides.provider ?? "manual",
    status: overrides.status,
    reference: overrides.reference ?? null,
    provider_payment_id: null,
    provider_order_id: null,
    provider_payload: null,
    idempotency_key: null,
    received_at: at,
    recorded_by: null,
    created_at: at,
    updated_at: at,
  };
}

function history(
  id: string,
  orderId: string,
  from: OrderStatusHistoryRow["from_status"],
  to: OrderStatusHistoryRow["to_status"],
  note: string,
  at: string,
): OrderStatusHistoryRow {
  return { id, order_id: orderId, from_status: from, to_status: to, note, changed_by: null, created_at: at };
}

export const sampleSettings: SettingsRow = {
  id: true,
  business_name: "Diecastly",
  business_phone: "+91 98765 43210",
  business_email: "hello@diecastly.in",
  upi_id: "diecastly@okhdfcbank",
  upi_qr_path: null,
  currency: "INR",
  cod_enabled: true,
  default_shipping_fee: 60,
  low_stock_threshold_default: 2,
  order_prefix: "DC",
  online_order_hold_hours: 48,
  in_person_reversal_window_hours: 24,
  updated_at: "2026-09-01T10:00:00+05:30",
};

export const sampleBusiness: ReceiptBusiness = businessSummary(sampleSettings);

export const sampleCatalog: SellableProduct[] = [
  { p: 1, name: "Hot Wheels '69 Camaro SS", brand: "Hot Wheels", series: "Muscle Mania", sku: "HW-69CAM", barcode: "887961000011", price: 249, qty: 6, thr: 2 },
  { p: 2, name: "Hot Wheels Nissan Skyline GT-R (R34)", brand: "Hot Wheels", series: "Boulevard", sku: "HW-R34", barcode: "887961000028", price: 599, qty: 2, thr: 2 },
  { p: 3, name: "Hot Wheels Porsche 911 GT3 RS", brand: "Hot Wheels", series: "Car Culture", sku: "HW-991GT3", barcode: "887961000035", price: 549, qty: 0, thr: 2 },
  { p: 4, name: "Matchbox Land Rover Defender 110", brand: "Matchbox", series: "Collectors", sku: "MB-DEF110", barcode: "887961000042", price: 199, qty: 14, thr: 3 },
  { p: 5, name: "Hot Wheels Toyota AE86 Sprinter Trueno", brand: "Hot Wheels", series: "Boulevard", sku: "HW-AE86", barcode: "887961000059", price: 575, qty: 4, thr: 2 },
  { p: 6, name: "Hot Wheels Lamborghini Countach LP5000", brand: "Hot Wheels", series: "Car Culture", sku: "HW-CTCH", barcode: "887961000066", price: 525, qty: 9, thr: 2 },
  { p: 7, name: "Hot Wheels Ford Mustang Boss 302", brand: "Hot Wheels", series: "Muscle Mania", sku: "HW-BOSS302", barcode: "887961000073", price: 229, qty: 21, thr: 4 },
  { p: 8, name: "Hot Wheels Batmobile (Animated Series)", brand: "Hot Wheels", series: "Pop Culture", sku: "HW-BATMB", barcode: "887961000080", price: 449, qty: 3, thr: 2 },
  { p: 9, name: "Hot Wheels Mazda RX-7 FD", brand: "Hot Wheels", series: "Boulevard", sku: "HW-RX7FD", barcode: "887961000097", price: 599, qty: 5, thr: 2 },
  { p: 10, name: "Mini GT Nissan Silvia S15", brand: "Mini GT", series: "Kaido House", sku: "MGT-S15", barcode: "490500000010", price: 1299, qty: 7, thr: 2 },
  { p: 11, name: "Hot Wheels Volkswagen T1 Panel Bus", brand: "Hot Wheels", series: "Car Culture", sku: "HW-T1BUS", barcode: "887961000103", price: 499, qty: 12, thr: 3 },
  { p: 12, name: "Matchbox Tesla Model S", brand: "Matchbox", series: "Moving Parts", sku: "MB-TESLAS", barcode: "887961000110", price: 249, qty: 0, thr: 3 },
].map((row) => ({
  id: `30000000-0000-0000-0000-0000000000${String(row.p).padStart(2, "0")}`,
  name: row.name,
  sku: row.sku,
  barcode: row.barcode,
  brand: row.brand,
  series: row.series,
  selling_price: row.price,
  quantity: row.qty,
  low_stock_threshold: row.thr,
  primary_image_path: null,
  status: "active",
}));

export const sampleSummaries: VOrderSummaryRow[] = [
  {
    order_id: "40000000-0000-0000-0000-000000000001",
    order_number: "DC-2026-00061",
    channel: "in_person",
    status: "completed",
    customer_id: null,
    customer_name: "Priya Nair",
    customer_phone: "+919876543210",
    payment_method: "cash",
    created_at: "2026-09-26T09:15:00+05:30",
    subtotal: 1697,
    discount_total: 100,
    shipping_fee: 0,
    shipping_cost: 0,
    total: 1697,
    cost_total: 1140,
    gross_profit: 557,
    contribution_after_shipping: 557,
    payment_status: "paid",
    net_paid: 1697,
    balance: 0,
  },
  {
    order_id: "40000000-0000-0000-0000-000000000002",
    order_number: "DC-2026-00060",
    channel: "online",
    status: "confirmed",
    customer_id: null,
    customer_name: "Arjun Rao",
    customer_phone: "+919812345678",
    payment_method: "upi",
    created_at: "2026-09-25T18:40:00+05:30",
    subtotal: 1898,
    discount_total: 0,
    shipping_fee: 60,
    shipping_cost: 45,
    total: 1958,
    cost_total: 1330,
    gross_profit: 568,
    contribution_after_shipping: 583,
    payment_status: "partial",
    net_paid: 1000,
    balance: 958,
  },
  {
    order_id: "40000000-0000-0000-0000-000000000003",
    order_number: "DC-2026-00059",
    channel: "in_person",
    status: "completed",
    customer_id: null,
    customer_name: null,
    customer_phone: null,
    payment_method: "cash",
    created_at: "2026-09-25T12:05:00+05:30",
    subtotal: 449,
    discount_total: 0,
    shipping_fee: 0,
    shipping_cost: 0,
    total: 449,
    cost_total: 300,
    gross_profit: 149,
    contribution_after_shipping: 149,
    payment_status: "paid",
    net_paid: 449,
    balance: 0,
  },
  {
    order_id: "40000000-0000-0000-0000-000000000004",
    order_number: "DC-2026-00058",
    channel: "online",
    status: "pending",
    customer_id: null,
    customer_name: "Meera Iyer",
    customer_phone: "+919845012345",
    payment_method: "upi",
    created_at: "2026-09-24T20:22:00+05:30",
    subtotal: 1299,
    discount_total: 0,
    shipping_fee: 0,
    shipping_cost: 0,
    total: 1299,
    cost_total: 950,
    gross_profit: 349,
    contribution_after_shipping: 349,
    payment_status: "unpaid",
    net_paid: 0,
    balance: 1299,
  },
  {
    order_id: "40000000-0000-0000-0000-000000000005",
    order_number: "DC-2026-00057",
    channel: "online",
    status: "shipped",
    customer_id: null,
    customer_name: "Karthik Subramanian",
    customer_phone: "+919900112233",
    payment_method: "cod",
    created_at: "2026-09-23T15:10:00+05:30",
    subtotal: 738,
    discount_total: 0,
    shipping_fee: 60,
    shipping_cost: 48,
    total: 798,
    cost_total: 480,
    gross_profit: 258,
    contribution_after_shipping: 270,
    payment_status: "cod_pending",
    net_paid: 0,
    balance: 798,
  },
  {
    order_id: "40000000-0000-0000-0000-000000000006",
    order_number: "DC-2026-00056",
    channel: "in_person",
    status: "cancelled",
    customer_id: null,
    customer_name: "Rahul Verma",
    customer_phone: "+919711223344",
    payment_method: "cash",
    created_at: "2026-09-22T11:30:00+05:30",
    subtotal: 599,
    discount_total: 0,
    shipping_fee: 0,
    shipping_cost: 0,
    total: 599,
    cost_total: 380,
    gross_profit: 219,
    contribution_after_shipping: 219,
    payment_status: "refunded",
    net_paid: 0,
    balance: 599,
  },
];

const inPersonId = "40000000-0000-0000-0000-000000000001";
const onlineId = "40000000-0000-0000-0000-000000000002";

export const sampleInPersonDetail: OrderDetail = {
  order: orderRow({
    id: inPersonId,
    order_number: "DC-2026-00061",
    channel: "in_person",
    status: "completed",
    customer_name: "Priya Nair",
    customer_phone: "+919876543210",
    payment_method: "cash",
    subtotal: 1697,
    discount_total: 100,
    total: 1697,
    cost_total: 1140,
    notes: "Collector asked for box protectors — added free.",
    created_at: "2026-09-26T09:15:00+05:30",
  }),
  financials: {
    order_id: inPersonId,
    order_number: "DC-2026-00061",
    total_due: 1697,
    total_received: 1697,
    total_refunded: 0,
    net_paid: 1697,
    balance: 0,
    payment_status: "paid",
  },
  items: [
    item("50000000-0000-0000-0000-000000000001", inPersonId, {
      product_name: "Hot Wheels Nissan Skyline GT-R (R34)",
      sku: "HW-R34",
      quantity: 1,
      unit_price: 599,
      unit_cost: 380,
    }),
    item("50000000-0000-0000-0000-000000000002", inPersonId, {
      product_name: "Hot Wheels Mazda RX-7 FD",
      sku: "HW-RX7FD",
      quantity: 2,
      unit_price: 599,
      unit_cost: 380,
      line_discount: 100,
    }),
  ],
  payments: [
    payment("60000000-0000-0000-0000-000000000001", inPersonId, {
      amount: 1000,
      method: "cash",
      status: "received",
      received_at: "2026-09-26T09:16:00+05:30",
    }),
    payment("60000000-0000-0000-0000-000000000002", inPersonId, {
      amount: 697,
      method: "upi",
      status: "received",
      reference: "UPI 4023118820",
      received_at: "2026-09-26T09:17:00+05:30",
    }),
  ],
  history: [history("70000000-0000-0000-0000-000000000001", inPersonId, null, "completed", "In-person sale recorded", "2026-09-26T09:15:00+05:30")],
};

export const sampleOnlineDetail: OrderDetail = {
  order: orderRow({
    id: onlineId,
    order_number: "DC-2026-00060",
    channel: "online",
    status: "confirmed",
    customer_name: "Arjun Rao",
    customer_phone: "+919812345678",
    customer_email: "arjun.rao@example.com",
    shipping_address: {
      line1: "12, 4th Cross, Indiranagar",
      line2: "2nd Stage",
      city: "Bengaluru",
      state: "Karnataka",
      postal_code: "560038",
      country: "India",
    },
    payment_method: "upi",
    shipping_fee: 60,
    shipping_cost: 45,
    subtotal: 1898,
    discount_total: 0,
    total: 1958,
    cost_total: 1330,
    expires_at: "2026-09-27T18:40:00+05:30",
    created_at: "2026-09-25T18:40:00+05:30",
  }),
  financials: {
    order_id: onlineId,
    order_number: "DC-2026-00060",
    total_due: 1958,
    total_received: 1000,
    total_refunded: 0,
    net_paid: 1000,
    balance: 958,
    payment_status: "partial",
  },
  items: [
    item("50000000-0000-0000-0000-000000000003", onlineId, {
      product_name: "Mini GT Nissan Silvia S15",
      sku: "MGT-S15",
      quantity: 1,
      unit_price: 1299,
      unit_cost: 950,
    }),
    item("50000000-0000-0000-0000-000000000004", onlineId, {
      product_name: "Hot Wheels Nissan Skyline GT-R (R34)",
      sku: "HW-R34",
      quantity: 1,
      unit_price: 599,
      unit_cost: 380,
    }),
  ],
  payments: [
    payment("60000000-0000-0000-0000-000000000003", onlineId, {
      amount: 1000,
      method: "upi",
      status: "received",
      reference: "UPI 4023129981",
      received_at: "2026-09-25T19:02:00+05:30",
    }),
  ],
  history: [
    history("70000000-0000-0000-0000-000000000002", onlineId, null, "pending", "Online order placed", "2026-09-25T18:40:00+05:30"),
    history("70000000-0000-0000-0000-000000000003", onlineId, "pending", "confirmed", "Payment verified", "2026-09-25T19:02:00+05:30"),
  ],
};
