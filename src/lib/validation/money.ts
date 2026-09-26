/**
 * Money helpers. All monetary arithmetic must go through these so values are
 * rounded consistently to 2 decimals (the database stores numeric(12,2)).
 */

/**
 * Rounds to two decimals, with halves going away from zero.
 *
 * The nudge compensates for binary representation error so a decimal half
 * rounds as it was written: 1.005 is stored as 1.00499999999999989 and must
 * still round up to 1.01. It is applied *away from zero* so the rule is
 * symmetric — nudging toward positive infinity instead would round -0.005 to
 * 0 while rounding 0.005 to 0.01, which is not a rounding rule.
 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Invalid money value");
  }
  const nudged = value + Math.sign(value) * Number.EPSILON;
  return (Math.sign(nudged) * Math.round(Math.abs(nudged) * 100)) / 100;
}

export function addMoney(...values: number[]): number {
  return roundMoney(values.reduce((total, value) => total + value, 0));
}

export function multiplyMoney(amount: number, quantity: number): number {
  return roundMoney(amount * quantity);
}

/** line_total = unit_price * quantity - line_discount (actual item revenue). */
export function lineTotal(unitPrice: number, quantity: number, lineDiscount = 0): number {
  return roundMoney(multiplyMoney(unitPrice, quantity) - roundMoney(lineDiscount));
}

/** line_profit = line_total - unit_cost * quantity (item revenue after discount - item COGS). */
export function lineProfit(
  unitPrice: number,
  unitCost: number,
  quantity: number,
  lineDiscount = 0,
): number {
  return roundMoney(lineTotal(unitPrice, quantity, lineDiscount) - multiplyMoney(unitCost, quantity));
}

/** product gross profit = subtotal - cost_total = sum(line_profit). */
export function productGrossProfit(subtotal: number, costTotal: number): number {
  return roundMoney(subtotal - costTotal);
}

/** order contribution after shipping = product gross profit + shipping_fee - shipping_cost. */
export function orderContribution(
  productGrossProfitValue: number,
  shippingFee: number,
  shippingCost: number,
): number {
  return roundMoney(productGrossProfitValue + shippingFee - shippingCost);
}

/** The largest discount a line may carry: its gross value (unit_price * quantity). */
export function maxLineDiscount(unitPrice: number, quantity: number): number {
  return multiplyMoney(unitPrice, quantity);
}

/**
 * Clamps a line discount to the line's gross value, so a line total can never
 * go negative. The database enforces the same rule (`invalid_discount`); this
 * is the client-side half, so the till can never build a line the server will
 * reject. Apply it whenever unit price, quantity or the discount itself
 * changes — a discount that was valid at one price is not valid at a lower one.
 */
export function clampLineDiscount(
  unitPrice: number,
  quantity: number,
  lineDiscount: number,
): number {
  if (!Number.isFinite(lineDiscount) || lineDiscount <= 0) return 0;
  return Math.min(roundMoney(lineDiscount), maxLineDiscount(unitPrice, quantity));
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundMoney(amount));
}
