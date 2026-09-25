import type {
  DerivedPaymentStatus,
  MovementSource,
  MovementType,
  OrderChannel,
  OrderStatus,
  PaymentMethod,
  ProductStatus,
} from "@/lib/types/database.types";

type BadgeTone = "neutral" | "outline" | "success" | "warning" | "danger" | "petrol";

export const productStatusLabel: Record<ProductStatus, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

export const productStatusTone: Record<ProductStatus, BadgeTone> = {
  draft: "neutral",
  active: "success",
  archived: "outline",
};

export const movementTypeLabel: Record<MovementType, string> = {
  initial: "Opening",
  restock: "Restock",
  sale: "Sale",
  order_cancel: "Cancellation",
  adjustment: "Adjustment",
  damage: "Damage",
  loss: "Loss",
  return: "Return",
};

export const movementTypeTone: Record<MovementType, BadgeTone> = {
  initial: "petrol",
  restock: "success",
  sale: "neutral",
  order_cancel: "warning",
  adjustment: "neutral",
  damage: "danger",
  loss: "danger",
  return: "success",
};

export const movementSourceLabel: Record<MovementSource, string> = {
  admin: "Admin",
  storefront: "Storefront",
  system: "System",
};

// ---------------------------------------------------------------------------
// Orders and payments
// ---------------------------------------------------------------------------

export const orderStatusLabel: Record<OrderStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  packed: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
  returned: "Returned",
};

export const orderStatusTone: Record<OrderStatus, BadgeTone> = {
  pending: "warning",
  confirmed: "petrol",
  packed: "petrol",
  shipped: "petrol",
  delivered: "success",
  completed: "success",
  cancelled: "danger",
  returned: "danger",
};

export const orderChannelLabel: Record<OrderChannel, string> = {
  in_person: "In person",
  online: "Online",
};

export const paymentMethodLabel: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  cod: "Cash on delivery",
  card: "Card",
  bank_transfer: "Bank transfer",
  other: "Other",
};

/** Plain-English meanings for the derived payment state. Never stored. */
export const paymentStatusLabel: Record<DerivedPaymentStatus, string> = {
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
  refunded: "Refunded",
  cod_pending: "Awaiting cash",
};

export const paymentStatusTone: Record<DerivedPaymentStatus, BadgeTone> = {
  unpaid: "warning",
  partial: "warning",
  paid: "success",
  refunded: "danger",
  cod_pending: "petrol",
};
