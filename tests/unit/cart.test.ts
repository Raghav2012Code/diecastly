import { describe, expect, it } from "vitest";
import {
  addLine,
  applyStockDrift,
  cartCount,
  cartSubtotal,
  cartTotal,
  compareCart,
  compareLine,
  MAX_LINE_QUANTITY,
  parseCart,
  quantityCap,
  refreshSnapshots,
  removeLine,
  setLineQuantity,
  type CartLine,
  type CartLineLive,
} from "@/lib/store/cart";

const PID = "11111111-1111-1111-1111-111111111111";
const PID2 = "22222222-2222-2222-2222-222222222222";

function line(over: Partial<CartLine> = {}): CartLine {
  return {
    productId: PID,
    quantity: 1,
    name: "Hot Wheels Skyline GT-R",
    unitPrice: 250,
    imagePath: null,
    slug: "skyline",
    available: 10,
    ...over,
  };
}

function live(over: Partial<CartLineLive> = {}): CartLineLive {
  return { productId: PID, name: "Hot Wheels Skyline GT-R", unitPrice: 250, available: 10, ...over };
}

describe("parseCart", () => {
  it("reads a well-formed cart", () => {
    expect(parseCart(JSON.stringify([line()]))).toHaveLength(1);
  });

  it("returns an empty cart for absent, malformed or non-array input", () => {
    expect(parseCart(null)).toEqual([]);
    expect(parseCart("")).toEqual([]);
    expect(parseCart("{not json")).toEqual([]);
    expect(parseCart('{"not":"an array"}')).toEqual([]);
  });

  it("drops a corrupt line but keeps the rest of the basket", () => {
    // localStorage is user-writable and survives deploys, so a cast here would
    // carry a negative quantity or a non-uuid product id straight into checkout.
    // Losing one line to a bad edit must not cost the shopper the other lines.
    const raw = JSON.stringify([line(), { productId: "not-a-uuid", quantity: 1 }, line({ quantity: -3 })]);
    const parsed = parseCart(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].productId).toBe(PID);
  });

  it("rejects a quantity above the per-line maximum", () => {
    expect(parseCart(JSON.stringify([line({ quantity: MAX_LINE_QUANTITY + 1 })]))).toEqual([]);
  });
});

describe("addLine", () => {
  it("appends a new product", () => {
    const { lines, capped } = addLine([], line());
    expect(lines).toHaveLength(1);
    expect(capped).toBe(false);
  });

  it("merges a repeat of the same product rather than duplicating the line", () => {
    const first = addLine([], line({ quantity: 2 }));
    const second = addLine(first.lines, line({ quantity: 3 }));
    expect(second.lines).toHaveLength(1);
    expect(second.lines[0].quantity).toBe(5);
  });

  it("caps the COMBINED quantity, not just the incoming one", () => {
    // The bug this guards: capping only the incoming amount lets a shopper
    // double past the limit by adding the same item repeatedly.
    const first = addLine([], line({ quantity: 4 }));
    expect(first.lines[0].quantity).toBe(4);

    const second = addLine(first.lines, line({ quantity: 4 }));
    expect(second.lines[0].quantity).toBe(8);
    expect(second.capped).toBe(false);

    const third = addLine(second.lines, line({ quantity: 4 }));
    expect(third.lines[0].quantity).toBe(10);
    expect(third.capped).toBe(true);
  });

  it("caps at availability and reports it", () => {
    const { lines, capped } = addLine([], line({ quantity: 5, available: 3 }));
    expect(lines[0].quantity).toBe(3);
    expect(capped).toBe(true);
  });

  it("does not add an out-of-stock product at all", () => {
    const { lines } = addLine([], line({ available: 0 }));
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(0);
  });

  it("takes the fresher snapshot for a repeated product", () => {
    const first = addLine([], line({ quantity: 1, unitPrice: 250 }));
    const second = addLine(first.lines, line({ quantity: 1, unitPrice: 300 }));
    expect(second.lines[0].unitPrice).toBe(300);
  });
});

describe("quantityCap", () => {
  it("never exceeds the availability or the per-line maximum", () => {
    expect(quantityCap(3)).toBe(3);
    expect(quantityCap(1000)).toBe(MAX_LINE_QUANTITY);
    expect(quantityCap(0)).toBe(0);
    expect(quantityCap(-5)).toBe(0);
  });
});

describe("setLineQuantity and removeLine", () => {
  it("clamps to the cap", () => {
    const lines = setLineQuantity([line({ quantity: 2 })], PID, 99);
    expect(lines[0].quantity).toBe(10);
  });

  it("removes the line when the quantity goes to zero or below", () => {
    expect(setLineQuantity([line()], PID, 0)).toEqual([]);
    expect(setLineQuantity([line()], PID, -1)).toEqual([]);
  });

  it("removes only the named line", () => {
    const lines = [line(), line({ productId: PID2 })];
    expect(removeLine(lines, PID)).toHaveLength(1);
    expect(removeLine(lines, PID)[0].productId).toBe(PID2);
  });
});

describe("cart money", () => {
  it("sums line totals through the money helpers", () => {
    // 2 x 250.005 would be 500.01 after rounding, not 500.00, if the total were
    // accumulated by repeated float addition.
    const lines = [line({ quantity: 2, unitPrice: 250.005 }), line({ productId: PID2, quantity: 1, unitPrice: 0.01 })];
    expect(cartSubtotal(lines)).toBe(500.02);
  });

  it("is zero for an empty cart", () => {
    expect(cartSubtotal([])).toBe(0);
    expect(cartTotal([], 50)).toBe(50);
  });

  it("adds the shipping fee to reach the order total", () => {
    expect(cartTotal([line({ quantity: 2 })], 40)).toBe(540);
  });

  it("counts units rather than lines", () => {
    expect(cartCount([line({ quantity: 2 }), line({ productId: PID2, quantity: 3 })])).toBe(5);
  });
});

describe("compareLine", () => {
  it("reports a matching line as ok", () => {
    expect(compareLine(line(), live())).toEqual({ kind: "ok" });
  });

  it("does not report a float artefact as a price change", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. Reporting that to a shopper as
    // "the price changed" would be indefensible, so both sides are rounded first.
    expect(compareLine(line({ unitPrice: 0.1 + 0.2 }), live({ unitPrice: 0.3 }))).toEqual({ kind: "ok" });
  });

  it("reports a real price move in either direction", () => {
    expect(compareLine(line({ unitPrice: 250 }), live({ unitPrice: 300 }))).toEqual({
      kind: "price",
      was: 250,
      now: 300,
    });
    expect(compareLine(line({ unitPrice: 250 }), live({ unitPrice: 200 }))).toEqual({
      kind: "price",
      was: 250,
      now: 200,
    });
  });

  it("reports a reduced quantity when stock cannot cover the line", () => {
    expect(compareLine(line({ quantity: 5 }), live({ available: 2 }))).toEqual({
      kind: "reduced",
      available: 2,
    });
  });

  it("distinguishes sold-out from reduced", () => {
    expect(compareLine(line({ quantity: 2 }), live({ available: 0 }))).toEqual({ kind: "unavailable" });
  });

  it("reports a product that has gone as removed", () => {
    expect(compareLine(line(), undefined)).toEqual({ kind: "removed" });
  });

  it("prefers the stock problem over the price, so the shopper is not offered a choice they cannot take", () => {
    // Both are wrong here. Reporting "the price changed, accept?" would be worse
    // than useless: accepting still cannot place the order.
    expect(compareLine(line({ quantity: 5, unitPrice: 250 }), live({ available: 1, unitPrice: 999 }))).toEqual({
      kind: "reduced",
      available: 1,
    });
  });
});

describe("compareCart", () => {
  const liveMap = new Map([
    [PID, live()],
    [PID2, live({ productId: PID2, name: "Second", unitPrice: 100, available: 10 })],
  ]);

  it("is clean when nothing moved", () => {
    expect(compareCart([line(), line({ productId: PID2, unitPrice: 100 })], liveMap).clean).toBe(true);
  });

  it("collects each kind of drift separately", () => {
    const cart = [
      line({ quantity: 1, unitPrice: 250 }),
      line({ productId: PID2, quantity: 1, unitPrice: 100, name: "Second" }),
    ];
    const drifted = new Map([
      [PID, live({ unitPrice: 300 })],
      [PID2, live({ productId: PID2, name: "Second", unitPrice: 100, available: 0 })],
    ]);
    const report = compareCart(cart, drifted);

    expect(report.clean).toBe(false);
    expect(report.priceChanges).toEqual([{ productId: PID, name: "Hot Wheels Skyline GT-R", was: 250, now: 300 }]);
    expect(report.removals).toEqual([{ productId: PID2, name: "Second" }]);
  });

  it("names a removed line from the cart, since the catalog no longer has it", () => {
    // A line that has vanished has no live row to take a name from, so the
    // snapshot the shopper last saw is the only honest thing to show them.
    const report = compareCart([line({ name: "Discontinued" })], new Map());
    expect(report.removals).toEqual([{ productId: PID, name: "Discontinued" }]);
  });

  it("uses the live name for a reduced line, in case it was renamed", () => {
    const report = compareCart(
      [line({ quantity: 5, name: "Old Name" })],
      new Map([[PID, live({ name: "New Name", available: 2 })]]),
    );
    expect(report.reductions).toEqual([{ productId: PID, name: "New Name", quantity: 2 }]);
  });
});

describe("applyStockDrift", () => {
  it("applies reductions and removals but leaves price changes for the shopper to decide", () => {
    const cart = [line({ quantity: 5, unitPrice: 250 }), line({ productId: PID2, quantity: 1 })];
    const report = compareCart(
      cart,
      new Map([
        [PID, live({ unitPrice: 999, available: 2 })],
        // PID2 has vanished entirely.
      ]),
    );

    const next = applyStockDrift(cart, report);
    expect(next).toHaveLength(1);
    expect(next[0].quantity).toBe(2);
    // The price is untouched, because agreeing to it is the shopper's decision.
    expect(next[0].unitPrice).toBe(250);
  });
});

describe("refreshSnapshots", () => {
  it("rewrites price and name from the live catalog and drops vanished lines", () => {
    const cart = [line({ quantity: 5, unitPrice: 250 }), line({ productId: PID2, quantity: 1 })];
    const next = refreshSnapshots(
      cart,
      new Map([[PID, live({ name: "Renamed", unitPrice: 300, available: 2 })]]),
    );

    expect(next).toHaveLength(1);
    expect(next[0].unitPrice).toBe(300);
    expect(next[0].name).toBe("Renamed");
    expect(next[0].quantity).toBe(2);
  });
});
