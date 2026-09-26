/**
 * Search-parameter parsing for the admin list pages.
 *
 * These pages used to cast raw query-string values straight to the expected
 * union type. A type assertion has no effect at runtime, so any string in the
 * URL reached the query:
 *
 *   * an unrecognised movement type was compared for equality against an enum
 *     column, which the database rejects, so the page rendered "movements could
 *     not be loaded" while the filter control — having no matching option —
 *     displayed "All movements";
 *   * an unrecognised stock value was treated as anything that is not the
 *     low-stock value, so `?stock=bogus` listed out-of-stock products and the
 *     control displayed "Out of stock". No error at all, just a wrong answer.
 *
 * A stale bookmark or a mistyped link is enough to reach either. Every value is
 * validated against the same enumerations the filter controls render their
 * options from, so the control and the query cannot disagree, and an
 * unrecognised value is treated as absent rather than substituted.
 */

import {
  DERIVED_PAYMENT_STATUSES,
  ORDER_CHANNELS,
  ORDER_STATUSES,
} from "@/lib/types/database.types";
import type { DerivedPaymentStatus, OrderChannel, OrderStatus } from "@/lib/types/database.types";

/** First present value for a parameter, or undefined. */
export function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The value if it is a member of `allowed`, otherwise undefined. A repeated
 * parameter is resolved to the first occurrence rather than left to whatever
 * the parser happens to do with an array.
 */
export function oneOf<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== "string" || first.length === 0) return undefined;
  return (allowed as readonly string[]).includes(first) ? (first as T) : undefined;
}

/** The value if it is "all" or a member of `allowed`; defaults to "all". */
export function oneOfWithAll<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T | "all" {
  return oneOf(value, allowed) ?? "all";
}

/** A positive integer page number; anything else is page 1. */
export function pageNumber(value: string | string[] | undefined): number {
  const first = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(first ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export const PRODUCT_STATUS_VALUES = ["draft", "active", "archived"] as const;
export const PRODUCT_STOCK_VALUES = ["low", "out"] as const;
export const PRODUCT_SORT_VALUES = ["newest", "name", "price", "cost", "stock"] as const;
export const INVENTORY_SCOPE_VALUES = ["all", "low", "out", "archived"] as const;
export const INVENTORY_SORT_VALUES = ["name", "stock", "threshold", "newest"] as const;
export const MOVEMENT_TYPE_VALUES = [
  "initial",
  "restock",
  "sale",
  "order_cancel",
  "adjustment",
  "damage",
  "loss",
  "return",
] as const;
export const MOVEMENT_SOURCE_VALUES = ["admin", "storefront", "system"] as const;

export type ProductStatusParam = (typeof PRODUCT_STATUS_VALUES)[number];
export type ProductStockParam = (typeof PRODUCT_STOCK_VALUES)[number];
export type ProductSortParam = (typeof PRODUCT_SORT_VALUES)[number];
export type InventoryScopeParam = (typeof INVENTORY_SCOPE_VALUES)[number];
export type InventorySortParam = (typeof INVENTORY_SORT_VALUES)[number];
export type MovementTypeParam = (typeof MOVEMENT_TYPE_VALUES)[number];
export type MovementSourceParam = (typeof MOVEMENT_SOURCE_VALUES)[number];
export type OrderStatusParam = OrderStatus;
export type OrderChannelParam = OrderChannel;
export type PaymentStatusParam = DerivedPaymentStatus;

export const orderStatusParam = (v: string | string[] | undefined) =>
  oneOfWithAll(v, ORDER_STATUSES as readonly OrderStatus[]);
export const orderChannelParam = (v: string | string[] | undefined) =>
  oneOfWithAll(v, ORDER_CHANNELS as readonly OrderChannel[]);
export const paymentStatusParam = (v: string | string[] | undefined) =>
  oneOfWithAll(v, DERIVED_PAYMENT_STATUSES as readonly DerivedPaymentStatus[]);
