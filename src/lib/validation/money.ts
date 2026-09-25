/**
 * Money helpers. All monetary arithmetic must go through these so values are
 * rounded consistently to 2 decimals (the database stores numeric(12,2)).
 */

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Invalid money value");
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundMoney(amount));
}
