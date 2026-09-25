import { describe, expect, it } from "vitest";
import {
  addMoney,
  formatINR,
  lineProfit,
  lineTotal,
  multiplyMoney,
  orderContribution,
  productGrossProfit,
  roundMoney,
} from "@/lib/validation/money";

describe("money rounding", () => {
  it("rounds to two decimals", () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(10)).toBe(10);
  });

  it("adds without floating point drift", () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
  });

  it("rejects non-finite values", () => {
    expect(() => roundMoney(Number.NaN)).toThrow();
    expect(() => roundMoney(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("multiplies and rounds", () => {
    expect(multiplyMoney(19.99, 3)).toBe(59.97);
  });
});

describe("canonical profit model", () => {
  it("line_total is unit_price * quantity - line_discount", () => {
    expect(lineTotal(100, 3, 50)).toBe(250);
    expect(lineTotal(100, 3, 0)).toBe(300);
  });

  it("line_profit subtracts COGS from line_total (discount applied once)", () => {
    // 3 x 100 = 300, minus 50 discount = 250 revenue; COGS 3 x 60 = 180; profit 70
    expect(lineProfit(100, 60, 3, 50)).toBe(70);
  });

  it("product gross profit equals subtotal minus cost_total", () => {
    expect(productGrossProfit(250, 180)).toBe(70);
  });

  it("order contribution adds shipping fee and subtracts shipping cost", () => {
    expect(orderContribution(70, 40, 25)).toBe(85);
  });
});

describe("formatINR", () => {
  it("formats Indian rupees with two decimals", () => {
    const formatted = formatINR(1234.5);
    expect(formatted).toContain("1,234.50");
  });
});
