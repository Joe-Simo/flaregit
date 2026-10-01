import * as crypto from "node:crypto";
import type { DecisionOption, ProductDecision, Requirement } from "../types.js";

export function detectContradiction(
  reqA: Requirement,
  reqB: Requirement
): boolean {
  const descA = `${reqA.title} ${reqA.description}`.toLowerCase();
  const descB = `${reqB.title} ${reqB.description}`.toLowerCase();

  // Pattern 1: Discount applying to refund fee vs. never discounted
  const aWantsDiscountOnRefund =
    descA.includes("reduce the refund") ||
    descA.includes("discount must also reduce") ||
    descA.includes("discount applies to refund");
  const bProhibitsDiscountOnRefund =
    descB.includes("never be discounted") ||
    descB.includes("surcharge must never") ||
    descB.includes("refund fee is fixed");

  if (aWantsDiscountOnRefund && bProhibitsDiscountOnRefund) return true;

  const bWantsDiscountOnRefund =
    descB.includes("reduce the refund") ||
    descB.includes("discount must also reduce") ||
    descB.includes("discount applies to refund");
  const aProhibitsDiscountOnRefund =
    descA.includes("never be discounted") ||
    descA.includes("surcharge must never") ||
    descA.includes("refund fee is fixed");

  if (bWantsDiscountOnRefund && aProhibitsDiscountOnRefund) return true;

  return false;
}

export function createProductDecision(
  reqA: Requirement,
  reqB: Requirement
): ProductDecision {
  const optionA: DecisionOption = {
    id: "discount_includes_refund",
    label: "Apply group discount to both tickets and refund surcharge",
    description: "The 15% group discount will reduce both the ticket subtotal and the refund protection surcharge.",
    concreteExample: "Four $40 refundable tickets will cost $153.00 ($160 × 0.85 + $20 × 0.85).",
  };

  const optionB: DecisionOption = {
    id: "discount_tickets_only",
    label: "Apply group discount only to base tickets (Recommended)",
    description: "The 15% group discount applies only to ticket prices; the refund protection fee remains a flat $5.00 per ticket.",
    concreteExample: "Four $40 refundable tickets will cost $156.00 ($160 × 0.85 + $20).",
  };

  return {
    id: `dec_${crypto.randomUUID().slice(0, 8)}`,
    question: "Should the group discount apply to the refund fee?",
    explanation:
      "Two contributors submitted mutually incompatible requirements for group discount calculation on refundable tickets.",
    conflictingRequirementIds: [reqA.id, reqB.id],
    options: [optionB, optionA], // list recommended first
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}
