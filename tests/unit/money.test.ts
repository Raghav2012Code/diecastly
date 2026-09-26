import { describe, expect, it } from "vitest";
import {
  addMoney,
  clampLineDiscount,
  formatINR,
  lineProfit,
  lineTotal,
  maxLineDiscount,
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

  it("rounds halves away from zero on both sides", () => {
    // The nudge must be applied away from zero. Nudging toward positive
    // infinity rounds -0.005 to 0 while rounding 0.005 to 0.01, which is not
    // a rounding rule and loses a paisa on loss-making lines.
    expect(roundMoney(0.005)).toBe(0.01);
    expect(roundMoney(-0.005)).toBe(-0.01);
    expect(roundMoney(0.015)).toBe(0.02);
    expect(roundMoney(-0.015)).toBe(-0.02);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(-1.005)).toBe(-1.01);
  });

  it("is symmetric about zero", () => {
    // A property, not a list of examples: rounding v and rounding -v must be
    // negatives of each other for every magnitude.
    for (let i = 1; i <= 500; i += 1) {
      const value = i / 8; // produces exact .125, .375, .625, .875 halves
      expect(roundMoney(-value)).toBe(-roundMoney(value));
    }
  });

  it("leaves ordinary two-decimal values untouched", () => {
    // Guards the change: no figure that is already correct may move.
    for (const value of [0, 0.01, -0.01, 1, -1, 19.99, -19.99, 1234.56, -1234.56, 999999.99]) {
      expect(roundMoney(value)).toBe(value);
    }
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

describe("line discount clamping", () => {
  it("caps the discount at the line's gross value", () => {
    expect(maxLineDiscount(100, 3)).toBe(300);
    expect(clampLineDiscount(100, 3, 50)).toBe(50);
    expect(clampLineDiscount(100, 3, 300)).toBe(300);
  });

  it("reduces a discount that was valid at a higher price", () => {
    // The exact sequence that used to produce a negative line total: a 100
    // discount on a line worth 100, repriced down to 50.
    expect(clampLineDiscount(100, 1, 100)).toBe(100);
    expect(clampLineDiscount(50, 1, 100)).toBe(50);
    expect(lineTotal(50, 1, clampLineDiscount(50, 1, 100))).toBe(0);
  });

  it("keeps a line total non-negative for any input", () => {
    for (let price = 1; price <= 40; price += 1) {
      for (let quantity = 1; quantity <= 4; quantity += 1) {
        for (const discount of [0, 7, 99, 1234.56]) {
          const clamped = clampLineDiscount(price, quantity, discount);
          expect(lineTotal(price, quantity, clamped)).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("treats a negative or non-finite discount as zero", () => {
    expect(clampLineDiscount(100, 2, -50)).toBe(0);
    expect(clampLineDiscount(100, 2, Number.NaN)).toBe(0);
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
