/**
 * Translates database/PostgREST errors into friendly, field-aware messages.
 * Raw SQL and constraint names must never reach the interface.
 */

export type FriendlyError = { message: string; field?: string };

export type Result<T> = { ok: true; data: T } | { ok: false; error: FriendlyError };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(error: unknown): { ok: false; error: FriendlyError } {
  return { ok: false, error: describeDbError(error) };
}

/**
 * A failure whose message is already user-facing.
 *
 * `fail` translates *database* errors, so a plain `{ message }` handed to it
 * matches no SQLSTATE, no constraint name and no token, and is replaced by the
 * generic message. That silently swallowed the one error in the app written
 * specifically to name a remedy — uniqueSlug's "set one explicitly" — which is
 * exactly the message an admin needs after 50 collisions.
 *
 * Use this when the application has already diagnosed the failure and knows the
 * remedy. Do not use it to bypass translation of a real database error.
 */
export function failWith(message: string): { ok: false; error: FriendlyError } {
  return { ok: false, error: { message } };
}

type DbErrorLike = { code?: string | null; message?: string | null; details?: string | null };

const UNIQUE_FIELDS: Record<string, { field: string; message: string }> = {
  products_slug_key: { field: "slug", message: "That URL slug is already in use." },
  products_sku_key: { field: "sku", message: "That SKU is already in use." },
  products_barcode_key: { field: "barcode", message: "That barcode is already in use." },
  categories_slug_key: { field: "slug", message: "That category slug is already in use." },
};

/**
 * Every code the migrations raise, with a message that names the remedy.
 *
 * This table is validated against the raised-code list by a unit test that
 * enumerates the codes explicitly, so a newly raised code fails the build
 * rather than reaching the admin as "Something went wrong". A generic message
 * therefore always means an unmapped code, which makes a bug report from the
 * interface actionable.
 *
 * The `already_initialized` case that used to be mapped here is gone: opening
 * stock already being recorded is a successful result carrying a flag, never
 * raised, so a message for it was unreachable.
 */
const MESSAGES: Array<[string, string]> = [
  // Stock
  ["insufficient_stock", "Not enough stock available for that change."],
  ["product_not_found", "That product no longer exists."],
  ["product_inactive", "Only active products can be sold."],
  ["invalid_quantity", "Enter a quantity greater than zero."],
  ["invalid_delta", "Enter a non-zero change."],
  ["invalid_reason", "Choose a valid reason."],
  // Prices and discounts
  ["invalid_unit_price", "Unit price must be greater than zero."],
  ["invalid_discount", "The discount is larger than the line value."],
  // Orders
  ["empty_items", "Add at least one item to the order."],
  ["order_not_found", "That order no longer exists."],
  ["invalid_transition", "That status change is not allowed from where the order is now."],
  ["use_cancel_order", "Cancel the order instead of changing its status."],
  ["outside_reversal_window", "This sale is outside the in-person reversal window."],
  // Payments
  ["invalid_payment", "Enter an amount greater than zero."],
  ["over_payment", "That is more than the outstanding balance."],
  ["over_refund", "You can only refund what has been received."],
  ["nothing_to_refund", "This order has no money to refund."],
  ["invalid_payment_method", "Choose a valid payment method."],
  ["idempotency_conflict", "This request key was already used for a different order."],
  // Storefront checkout
  ["customer_required", "Customer details are required."],
  ["customer_name_phone_required", "A customer name and phone number are required."],
  ["shipping_address_required", "A shipping address is required."],
  ["cod_disabled", "Cash on delivery is switched off. Offer another payment method."],
  // Product images
  ["image_not_found", "That image no longer exists."],
  ["image_set_mismatch", "The image list changed. Reload and try again."],
  // Authorization
  ["not_authorized", "You are not authorized to do that."],
];

/** The generic fallback. Reaching it means a raised code is missing from MESSAGES. */
export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export function describeDbError(error: unknown): FriendlyError {
  if (!error || typeof error !== "object") {
    return { message: "Something went wrong. Please try again." };
  }

  const { code, message, details } = error as DbErrorLike;
  const haystack = `${message ?? ""} ${details ?? ""}`;

  if (code === "23505" || haystack.includes("duplicate key")) {
    const match = Object.entries(UNIQUE_FIELDS).find(([constraint]) => haystack.includes(constraint));
    if (match) {
      return { field: match[1].field, message: match[1].message };
    }
    return { message: "A record with these details already exists." };
  }

  if (code === "23503") {
    return { message: "That reference no longer exists. Refresh and try again." };
  }

  if (code === "42501") {
    return { message: "You are not authorized to do that." };
  }

  // A bare `raise exception 'some_code'` sets the Postgres message to the code
  // itself, so an exact hit is the common case and is unambiguous.
  const trimmed = haystack.trim();
  const exact = MESSAGES.find(([needle]) => needle === trimmed);
  if (exact) return { message: exact[1] };

  // Fall back to a substring search, but take the LONGEST matching token rather
  // than the first. Scanning in declaration order let a token that is a prefix
  // of another shadow it: `invalid_payment` sits four entries above
  // `invalid_payment_method`, so a rejected payment method was reported as
  // "Enter an amount greater than zero." Longest-first makes the order of this
  // table irrelevant, so the next code added cannot introduce the same bug.
  let best: [string, string] | undefined;
  for (const entry of MESSAGES) {
    if (haystack.includes(entry[0]) && (best === undefined || entry[0].length > best[0].length)) {
      best = entry;
    }
  }
  if (best) return { message: best[1] };

  return { message: GENERIC_ERROR_MESSAGE };
}