import type { MovementType, ProductStatus } from "@/lib/types/database.types";

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

export const movementSourceLabel: Record<string, string> = {
  admin: "Admin",
  storefront: "Storefront",
  system: "System",
};
