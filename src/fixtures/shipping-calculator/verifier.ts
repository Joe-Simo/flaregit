import * as crypto from "node:crypto";
import * as path from "node:path";
import * as fs from "node:fs";
import type { VerificationEvidence, TestResultItem } from "../../core/types.js";

export interface ShippingVerifierContext {
  repoDir: string;
  candidateCommit: string;
  expectedBase: string;
  requirementsVersion: number;
}

export async function runShippingProtectedVerification(
  ctx: ShippingVerifierContext
): Promise<VerificationEvidence> {
  const items: TestResultItem[] = [];

  const ratesModulePath = path.join(ctx.repoDir, "src", "rates.ts");
  if (!fs.existsSync(ratesModulePath)) {
    throw new Error(`Critical source missing: ${ratesModulePath}`);
  }

  // Load candidate module
  const ratesModule = await import(`file://${ratesModulePath}?t=${Date.now()}`);
  const { calculateShipping } = ratesModule;

  // 1. Contract 1: Base minimum freight
  const t1Start = performance.now();
  try {
    const q1 = calculateShipping({ weightKg: 2, speed: "standard" });
    const passed = Math.abs(q1.total - 15.0) < 0.01 && q1.baseRate === 15.0;
    items.push({
      testId: "CHECK-SHIPPING-BASE-MINIMUM",
      description: "2kg parcel charges minimum baseline fee of $15.00",
      passed,
      durationMs: Math.round(performance.now() - t1Start),
    });
  } catch (err: any) {
    items.push({
      testId: "CHECK-SHIPPING-BASE-MINIMUM",
      description: "2kg parcel charges minimum baseline fee of $15.00",
      passed: false,
      message: err.message,
      durationMs: Math.round(performance.now() - t1Start),
    });
  }

  // 2. Contract 2: Linear weight freight
  const t2Start = performance.now();
  try {
    const q2 = calculateShipping({ weightKg: 10, speed: "standard" });
    const passed = Math.abs(q2.total - 30.0) < 0.01;
    items.push({
      testId: "CHECK-SHIPPING-WEIGHT-RATE",
      description: "10kg standard parcel calculates to exactly $30.00 (10 × $3.00)",
      passed,
      durationMs: Math.round(performance.now() - t2Start),
    });
  } catch (err: any) {
    items.push({
      testId: "CHECK-SHIPPING-WEIGHT-RATE",
      description: "10kg standard parcel calculates to exactly $30.00",
      passed: false,
      message: err.message,
      durationMs: Math.round(performance.now() - t2Start),
    });
  }

  // 3. Contract 3: Express speed surcharge (+50%)
  const t3Start = performance.now();
  try {
    const q3 = calculateShipping({ weightKg: 10, speed: "express" });
    const passed = Math.abs(q3.total - 45.0) < 0.01 && q3.speedSurcharge === 15.0;
    items.push({
      testId: "CHECK-SHIPPING-EXPRESS-SURCHARGE",
      description: "10kg express parcel calculates to $45.00 ($30 base + $15 express surcharge)",
      passed,
      durationMs: Math.round(performance.now() - t3Start),
    });
  } catch (err: any) {
    items.push({
      testId: "CHECK-SHIPPING-EXPRESS-SURCHARGE",
      description: "10kg express parcel calculates to $45.00",
      passed: false,
      message: err.message,
      durationMs: Math.round(performance.now() - t3Start),
    });
  }

  // 4. Contract 4: Hazardous material handling fee (+$12)
  const t4Start = performance.now();
  try {
    const q4 = calculateShipping({ weightKg: 10, speed: "express", isHazardous: true });
    const passed = Math.abs(q4.total - 57.0) < 0.01 && q4.hazardousFee === 12.0;
    items.push({
      testId: "CHECK-SHIPPING-HAZARDOUS-FEE",
      description: "10kg express hazardous parcel calculates to $57.00 ($45 express + $12 hazardous)",
      passed,
      durationMs: Math.round(performance.now() - t4Start),
    });
  } catch (err: any) {
    items.push({
      testId: "CHECK-SHIPPING-HAZARDOUS-FEE",
      description: "10kg express hazardous parcel calculates to $57.00",
      passed: false,
      message: err.message,
      durationMs: Math.round(performance.now() - t4Start),
    });
  }

  // 5. Contract 5: Bulk freight weight tier discount (-15% for >= 20kg)
  const t5Start = performance.now();
  try {
    const q5 = calculateShipping({ weightKg: 25, speed: "standard" });
    // 25 * 3 = $75. discount = 15% of 75 = $11.25. total = $63.75
    const passed = Math.abs(q5.total - 63.75) < 0.01 && Math.abs(q5.weightDiscount - 11.25) < 0.01;
    items.push({
      testId: "CHECK-SHIPPING-BULK-TIER-DISCOUNT",
      description: "25kg freight parcel qualifies for bulk 15% discount ($75 - $11.25 = $63.75)",
      passed,
      durationMs: Math.round(performance.now() - t5Start),
    });
  } catch (err: any) {
    items.push({
      testId: "CHECK-SHIPPING-BULK-TIER-DISCOUNT",
      description: "25kg freight parcel qualifies for bulk discount",
      passed: false,
      message: err.message,
      durationMs: Math.round(performance.now() - t5Start),
    });
  }

  const passedCount = items.filter((i) => i.passed).length;
  const failedCount = items.length - passedCount;
  const allPassed = failedCount === 0;

  const testBundleDigest = crypto
    .createHash("sha256")
    .update(fs.readFileSync(__filename))
    .digest("hex");

  const builtOutputDigest = crypto
    .createHash("sha256")
    .update(fs.readFileSync(ratesModulePath))
    .digest("hex");

  return {
    id: `ev-ship-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    candidateCommit: ctx.candidateCommit,
    expectedAcceptedBase: ctx.expectedBase,
    requirementsVersion: ctx.requirementsVersion,
    testBundleDigest,
    toolchainDigest: "bun-v1.3.4-ts5.9.3",
    builtOutputDigest,
    verifierIdentity: "flaregit-shipping-protected-verifier-v1",
    testResults: [
      {
        suite: "ShippingProtectedVerificationSuite",
        passed: allPassed,
        passedCount,
        failedCount,
        items,
      },
    ],
    timestamp: new Date().toISOString(),
    status: allPassed ? "passed" : "failed",
  };
}
