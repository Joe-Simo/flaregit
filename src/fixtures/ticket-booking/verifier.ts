import * as crypto from "node:crypto";
import type { TestResultItem, VerificationEvidence } from "../../core/types.js";

export interface FixtureVerifyContext {
  candidateCommit: string;
  expectedBase: string;
  requirementsVersion: number;
  calculateQuote: (params: {
    ticketCount: number;
    basePrice: number;
    isRefundable?: boolean;
  }) => {
    ticketCount: number;
    basePrice: number;
    ticketTotal: number;
    discountAmount: number;
    refundFeeTotal: number;
    total: number;
    isRefundable: boolean;
    receiptItems?: Array<{ description: string; amount: number; isDiscount?: boolean }>;
  };
  catalogEvents?: Array<{ id: string; price: number }>;
  policy: {
    groupDiscountPercent?: number; // e.g. 0.15
    minTicketsForDiscount?: number; // e.g. 4
    refundFeePerTicket?: number; // e.g. 5.0
    discountAppliesToRefundFee?: boolean; // false in Act I/II, true or false in Act III
  };
}

export function runProtectedVerification(ctx: FixtureVerifyContext): VerificationEvidence {
  const items: TestResultItem[] = [];
  const { calculateQuote, policy } = ctx;

  // Check 1: Baseline single ticket non-refundable
  const t1Start = performance.now();
  try {
    const q1 = calculateQuote({ ticketCount: 1, basePrice: 40, isRefundable: false });
    const passed = q1.total === 40 && q1.discountAmount === 0 && q1.refundFeeTotal === 0;
    items.push({
      testId: "REQ-BASE-SINGLE-TICKET",
      description: "1 ticket @ $40 without extras equals exactly $40.00",
      passed,
      message: passed ? undefined : `Expected total=40, got total=${q1.total}`,
      durationMs: Math.round(performance.now() - t1Start),
    });
  } catch (err: any) {
    items.push({
      testId: "REQ-BASE-SINGLE-TICKET",
      description: "1 ticket @ $40 without extras equals exactly $40.00",
      passed: false,
      message: `Exception during evaluation: ${err.message}`,
      durationMs: Math.round(performance.now() - t1Start),
    });
  }

  // Check 2: Group discount feature (if policy specifies group discount)
  if (policy.groupDiscountPercent !== undefined && policy.minTicketsForDiscount !== undefined) {
    const t2Start = performance.now();
    try {
      // 4 tickets @ $40 = $160 subtotal; 15% discount = $24; total = $136
      const q = calculateQuote({
        ticketCount: policy.minTicketsForDiscount,
        basePrice: 40,
        isRefundable: false,
      });
      const expectedDiscount = 40 * policy.minTicketsForDiscount * policy.groupDiscountPercent;
      const expectedTotal = 40 * policy.minTicketsForDiscount - expectedDiscount;
      const passed =
        Math.abs(q.discountAmount - expectedDiscount) < 0.01 &&
        Math.abs(q.total - expectedTotal) < 0.01;
      items.push({
        testId: "REQ-GROUP-DISCOUNT-15",
        description: `Group discount of ${policy.groupDiscountPercent * 100}% applies for ${policy.minTicketsForDiscount}+ tickets`,
        passed,
        message: passed
          ? undefined
          : `Expected discount=${expectedDiscount}, total=${expectedTotal}; got discount=${q.discountAmount}, total=${q.total}`,
        durationMs: Math.round(performance.now() - t2Start),
      });
    } catch (err: any) {
      items.push({
        testId: "REQ-GROUP-DISCOUNT-15",
        description: `Group discount applies for ${policy.minTicketsForDiscount}+ tickets`,
        passed: false,
        message: `Exception during discount check: ${err.message}`,
        durationMs: Math.round(performance.now() - t2Start),
      });
    }
  }

  // Check 3: Refundable tickets feature (if policy specifies refund fee)
  if (policy.refundFeePerTicket !== undefined) {
    const t3Start = performance.now();
    try {
      // 2 tickets @ $40 refundable: subtotal $80 + 2 * $5 = $90
      const q = calculateQuote({ ticketCount: 2, basePrice: 40, isRefundable: true });
      const expectedRefundFee = 2 * policy.refundFeePerTicket;
      const expectedTotal = 80 + expectedRefundFee;
      const passed =
        q.isRefundable === true &&
        Math.abs(q.refundFeeTotal - expectedRefundFee) < 0.01 &&
        Math.abs(q.total - expectedTotal) < 0.01;
      items.push({
        testId: "REQ-REFUNDABLE-TICKET-SURCHARGE",
        description: `Refundable tickets add $${policy.refundFeePerTicket} surcharge per ticket with active indicator`,
        passed,
        message: passed
          ? undefined
          : `Expected isRefundable=true, fee=${expectedRefundFee}, total=${expectedTotal}; got isRefundable=${q.isRefundable}, fee=${q.refundFeeTotal}, total=${q.total}`,
        durationMs: Math.round(performance.now() - t3Start),
      });
    } catch (err: any) {
      items.push({
        testId: "REQ-REFUNDABLE-TICKET-SURCHARGE",
        description: `Refundable tickets add surcharge per ticket`,
        passed: false,
        message: `Exception during refundable check: ${err.message}`,
        durationMs: Math.round(performance.now() - t3Start),
      });
    }
  }

  // Check 4: Cross-feature Interaction Test (Act I & Act III test)
  if (
    policy.groupDiscountPercent !== undefined &&
    policy.minTicketsForDiscount !== undefined &&
    policy.refundFeePerTicket !== undefined
  ) {
    const t4Start = performance.now();
    try {
      // Four $40 refundable tickets:
      // Subtotal = $160
      // Discount = $160 * 0.15 = $24
      // Refund fee = 4 * $5 = $20
      // If discount does NOT apply to refund fee:
      // Total = ($160 - $24) + $20 = $156
      // If discount DOES apply to refund fee:
      // Total = ($160 + $20) * 0.85 = $153
      const q = calculateQuote({ ticketCount: 4, basePrice: 40, isRefundable: true });
      const expectedTotal = policy.discountAppliesToRefundFee ? 153 : 156;
      const passed = Math.abs(q.total - expectedTotal) < 0.01;
      items.push({
        testId: "REQ-INTERACTION-DISCOUNT-AND-REFUND",
        description: `Four $40 refundable tickets calculate correctly according to policy ($${expectedTotal}.00)`,
        passed,
        message: passed
          ? undefined
          : `Expected total=$${expectedTotal}.00, got total=$${q.total.toFixed(2)} (discount=${q.discountAmount}, refundFee=${q.refundFeeTotal})`,
        durationMs: Math.round(performance.now() - t4Start),
      });
    } catch (err: any) {
      items.push({
        testId: "REQ-INTERACTION-DISCOUNT-AND-REFUND",
        description: "Interaction between discount and refund fee",
        passed: false,
        message: `Exception: ${err.message}`,
        durationMs: Math.round(performance.now() - t4Start),
      });
    }
  }

  // Check 5: Catalog unit consistency & itemized receipt lines (Act II)
  if (ctx.catalogEvents && ctx.catalogEvents.length > 0) {
    const t5Start = performance.now();
    try {
      // If catalog price is in cents (e.g. 4000 instead of 40), quote must produce correct dollar amounts, not 4000 dollars!
      const firstEvent = ctx.catalogEvents[0]!;
      // If price > 500, it's represented in cents, so $40.00 is 4000 cents
      const isCents = firstEvent.price >= 500;
      const normalizedBase = isCents ? firstEvent.price / 100 : firstEvent.price;
      const q = calculateQuote({ ticketCount: 1, basePrice: normalizedBase, isRefundable: false });
      
      const passed = Math.abs(q.total - 40) < 0.01;
      items.push({
        testId: "REQ-CATALOG-UNITS-CONTRACT",
        description: "Catalog pricing units align consistently with quote consumer ($40.00 total)",
        passed,
        message: passed ? undefined : `Expected $40.00 total from catalog, got $${q.total.toFixed(2)}`,
        durationMs: Math.round(performance.now() - t5Start),
      });
    } catch (err: any) {
      items.push({
        testId: "REQ-CATALOG-UNITS-CONTRACT",
        description: "Catalog units contract",
        passed: false,
        message: `Exception during units check: ${err.message}`,
        durationMs: Math.round(performance.now() - t5Start),
      });
    }
  }

  // Calculate digests
  const passedCount = items.filter((i) => i.passed).length;
  const failedCount = items.length - passedCount;
  const allPassed = failedCount === 0;

  const testBundleDigest = crypto
    .createHash("sha256")
    .update(JSON.stringify(items.map((i) => ({ id: i.testId, desc: i.description }))))
    .digest("hex");

  const builtOutputDigest = crypto
    .createHash("sha256")
    .update(`candidate:${ctx.candidateCommit}:policy:${JSON.stringify(ctx.policy)}`)
    .digest("hex");

  return {
    id: `ev_${crypto.randomUUID().slice(0, 12)}`,
    candidateCommit: ctx.candidateCommit,
    expectedAcceptedBase: ctx.expectedBase,
    requirementsVersion: ctx.requirementsVersion,
    testBundleDigest,
    toolchainDigest: "bun-v1.3.4-ts5.9.3",
    builtOutputDigest,
    verifierIdentity: "flaregit-protected-verifier-v1",
    testResults: [
      {
        suite: "TicketBookingProtectedSuite",
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
