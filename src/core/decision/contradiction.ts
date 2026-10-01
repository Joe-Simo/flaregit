import * as crypto from "node:crypto";
import type { DecisionOption, ProductDecision, Requirement, RequirementAssertion } from "../types.js";

function sameInput(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, v]) => [k, canonical(v)])
    );
  }
  return value;
}

/**
 * Two approved requirements contradict when they specify different expected outputs for the same
 * input. This is structural (not keyword matching), so it applies to any domain.
 */
export function findContradiction(
  reqA: Requirement,
  reqB: Requirement
): { assertionA: RequirementAssertion; assertionB: RequirementAssertion } | null {
  for (const a of reqA.assertions) {
    for (const b of reqB.assertions) {
      if (a.input === undefined || b.input === undefined) continue;
      if (a.expectedOutput === undefined || b.expectedOutput === undefined) continue;
      if (sameInput(a.input, b.input) && !sameInput(a.expectedOutput, b.expectedOutput)) {
        return { assertionA: a, assertionB: b };
      }
    }
  }
  return null;
}

export function detectContradiction(reqA: Requirement, reqB: Requirement): boolean {
  return findContradiction(reqA, reqB) !== null;
}

export function createProductDecision(reqA: Requirement, reqB: Requirement): ProductDecision {
  const found = findContradiction(reqA, reqB);
  const option = (req: Requirement, assertion?: RequirementAssertion): DecisionOption => ({
    id: req.id,
    label: req.title,
    description: req.description,
    concreteExample: assertion?.description ?? req.description,
  });

  return {
    id: `dec_${crypto.randomUUID().slice(0, 8)}`,
    question:
      reqA.clarifyingQuestion ??
      reqB.clarifyingQuestion ??
      `Which behavior is correct: "${reqA.title}" or "${reqB.title}"?`,
    explanation:
      "Two approved requirements specify different results for the same input, so both cannot hold. " +
      "The last accepted version stays live until you choose.",
    conflictingRequirementIds: [reqA.id, reqB.id],
    options: [option(reqA, found?.assertionA), option(reqB, found?.assertionB)],
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}
