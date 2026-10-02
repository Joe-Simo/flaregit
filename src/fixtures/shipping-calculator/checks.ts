import type { TestResultItem } from "../../core/types.js";

export type Quote = {
  baseRate: number;
  speedSurcharge: number;
  hazardousFee: number;
  weightDiscount: number;
  total: number;
  receiptItems?: Array<{ description: string; amount: number }>;
};
export type Params = { weightKg: number; speed: "standard" | "express" | "overnight"; isHazardous?: boolean; insuranceValueUsd?: number };
export function quoteKey(params: Params): string { return `${params.weightKg}:${params.speed}:${params.isHazardous === true}`; }

async function check(items: TestResultItem[], testId: string, description: string, fn: () => void) {
  const started = performance.now();
  try {
    fn();
    items.push({ testId, description, passed: true, durationMs: Math.round(performance.now() - started) });
  } catch (err) {
    items.push({
      testId,
      description,
      passed: false,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - started),
    });
  }
}

function near(actual: number, expected: number, label: string) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.005) {
    throw new Error(`${label}: expected ${expected.toFixed(2)}, got ${actual}`);
  }
}

export async function runChecks(_dir: string, _policy: unknown, observations: Record<string, Quote>): Promise<TestResultItem[]> {
  const items: TestResultItem[] = [];
  const calculateShipping = (params: Params) => observations[quoteKey(params)]!;

  await check(items, "CHECK-SHIPPING-BASE-MINIMUM", "2kg parcel charges the $15.00 minimum", () => {
    const q = calculateShipping({ weightKg: 2, speed: "standard" });
    near(q.total, 15, "total");
    near(q.baseRate, 15, "base");
  });
  await check(items, "CHECK-SHIPPING-WEIGHT-RATE", "10kg standard parcel is $30.00", () =>
    near(calculateShipping({ weightKg: 10, speed: "standard" }).total, 30, "total")
  );
  await check(items, "CHECK-SHIPPING-EXPRESS-SURCHARGE", "10kg express parcel is $45.00", () => {
    const q = calculateShipping({ weightKg: 10, speed: "express" });
    near(q.total, 45, "total");
    near(q.speedSurcharge, 15, "express surcharge");
  });
  await check(items, "CHECK-SHIPPING-HAZARDOUS-FEE", "10kg express hazardous parcel is $57.00", () => {
    const q = calculateShipping({ weightKg: 10, speed: "express", isHazardous: true });
    near(q.total, 57, "total");
    near(q.hazardousFee, 12, "hazardous fee");
  });
  await check(items, "CHECK-SHIPPING-BULK-TIER-DISCOUNT", "25kg parcel receives the 15% bulk discount ($63.75)", () => {
    const q = calculateShipping({ weightKg: 25, speed: "standard" });
    near(q.total, 63.75, "total");
    near(q.weightDiscount, 11.25, "bulk discount");
  });
  await check(items, "CHECK-SHIPPING-RECEIPT-RECONCILES", "Receipt line items sum to the quoted total", () => {
    const q = calculateShipping({ weightKg: 10, speed: "express", isHazardous: true });
    if (!q.receiptItems) return;
    near(q.receiptItems.reduce((a, i) => a + i.amount, 0), q.total, "receipt sum");
  });
  return items;
}
