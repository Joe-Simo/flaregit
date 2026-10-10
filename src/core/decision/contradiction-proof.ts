import { z } from "zod";
import type { Requirement, RequirementAssertion } from "../types.js";
import { findContradiction } from "./contradiction.js";
import { requirementProbeSchema } from "../requirement-drafts.js";

export { requirementProbeSchema };

/**
 * Executable proof that two requirements contradict. The structural check in contradiction.ts finds two
 * assertions that demand different outputs for the same input; this module turns that into something a
 * person can trust: each side's change is checked out and its code is run on that exact input.
 */

export type RequirementProbe = z.infer<typeof requirementProbeSchema>;

const probeOutcomeSchema = z.union([
  z.object({ ok: z.literal(true), output: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), error: z.string().max(2000) }).strict(),
]);
export type ProbeOutcome = z.infer<typeof probeOutcomeSchema>;

/** Parses the last JSON line a probe printed; anything else is an execution failure, never a pass. */
export function parseProbeOutput(stdout: string): ProbeOutcome {
  const line = stdout.trim().split("\n").at(-1) ?? "";
  try {
    const parsed = probeOutcomeSchema.safeParse(JSON.parse(line));
    if (parsed.success) return parsed.data;
  } catch {
    /* Malformed output is reported below. */
  }
  return { ok: false, error: "The code did not report a result" };
}

const sha = z.string().regex(/^[a-f0-9]{40}$/);
export const proofSideSchema = z
  .object({
    taskId: z.string().min(1).max(128),
    requirementId: z.string().min(1).max(200),
    requirementTitle: z.string().max(500),
    commit: sha,
    expected: z.unknown(),
    actual: z.unknown().optional(),
    error: z.string().max(2000).optional(),
    meetsOwnRequirement: z.boolean(),
    meetsOtherRequirement: z.boolean(),
  })
  .strict();
export type ProofSide = z.infer<typeof proofSideSchema>;

export const contradictionProofSchema = z
  .object({
    version: z.literal(1),
    decisionId: z.string().min(1).max(120),
    input: z.record(z.string(), z.unknown()),
    probe: requirementProbeSchema,
    sides: z.tuple([proofSideSchema, proofSideSchema]),
    verdict: z.enum(["proven", "not_reproduced", "execution_failed"]),
    summary: z.string().min(1).max(2000),
    executedAt: z.string().datetime(),
  })
  .strict();
export type ContradictionProof = z.infer<typeof contradictionProofSchema>;

export interface ContradictionProofPlan {
  input: Record<string, unknown>;
  probe: RequirementProbe;
  assertionA: RequirementAssertion;
  assertionB: RequirementAssertion;
}

/** The exact input and code entry point both sides are run on, or null when nothing is executable. */
export function contradictionProofPlan(reqA: Requirement, reqB: Requirement): ContradictionProofPlan | null {
  const found = findContradiction(reqA, reqB);
  if (!found || !found.assertionA.input) return null;
  const probes = [found.assertionA.probe, found.assertionB.probe].filter((probe) => probe !== undefined);
  if (!probes.length) return null;
  const parsed = probes.map((probe) => requirementProbeSchema.safeParse(probe));
  if (parsed.some((result) => !result.success)) return null;
  const [first, second] = parsed.map((result) => result.data!);
  if (second && (second.module !== first!.module || second.export !== first!.export)) return null;
  return { input: structuredClone(found.assertionA.input), probe: first!, assertionA: found.assertionA, assertionB: found.assertionB };
}

const TOLERANCE = 0.005;
/** `actual` meets `expected` when every expected field is present with the same value (cents tolerance for numbers). */
export function matchesExpected(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "number") return typeof actual === "number" && Number.isFinite(actual) && Math.abs(actual - expected) <= TOLERANCE;
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => matchesExpected(actual[index], value));
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected as Record<string, unknown>).every(([key, value]) => Object.hasOwn(actual, key) && matchesExpected((actual as Record<string, unknown>)[key], value));
  }
  return Object.is(actual, expected);
}

/** Plain-language rendering of a value for people reading the decision. */
export function describeValue(value: unknown): string {
  if (value === undefined) return "nothing";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "string") return `"${value}"`;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.map(([key, item]) => `${key} ${describeValue(item)}`).join(", ") || "an empty result";
  }
  return JSON.stringify(value) ?? String(value);
}

/** Only the fields the requirements talk about are shown and stored, never a whole module result. */
function project(actual: unknown, expectations: unknown[]): unknown {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return actual;
  const keys = new Set(expectations.flatMap((expected) => (expected && typeof expected === "object" && !Array.isArray(expected) ? Object.keys(expected) : [])));
  if (!keys.size) return actual;
  return Object.fromEntries([...keys].filter((key) => Object.hasOwn(actual, key)).map((key) => [key, (actual as Record<string, unknown>)[key]]));
}

export interface ExecutedSide {
  taskId: string;
  commit: string;
  requirement: Requirement;
  outcome: ProbeOutcome;
}

export function evaluateContradictionProof(decisionId: string, plan: ContradictionProofPlan, executed: [ExecutedSide, ExecutedSide], executedAt = new Date()): ContradictionProof {
  const expectations: [unknown, unknown] = [plan.assertionA.expectedOutput, plan.assertionB.expectedOutput];
  const sides = executed.map((side, index): ProofSide => {
    const own = expectations[index], other = expectations[1 - index];
    const base = { taskId: side.taskId, requirementId: side.requirement.id, requirementTitle: side.requirement.title.slice(0, 500), commit: side.commit, expected: own };
    if (!side.outcome.ok) return { ...base, error: side.outcome.error.slice(0, 2000), meetsOwnRequirement: false, meetsOtherRequirement: false };
    return { ...base, actual: project(side.outcome.output, expectations), meetsOwnRequirement: matchesExpected(side.outcome.output, own), meetsOtherRequirement: matchesExpected(side.outcome.output, other) };
  }) as [ProofSide, ProofSide];
  const [a, b] = sides;
  const input = describeValue(plan.input);
  let verdict: ContradictionProof["verdict"];
  let summary: string;
  if (a.error !== undefined || b.error !== undefined) {
    verdict = "execution_failed";
    const failed = [a, b].filter((side) => side.error !== undefined).map((side) => `"${side.requirementTitle}" (${side.error})`).join(" and ");
    summary = `Both requirements expect different results for ${input}, so they cannot both hold. Running the code for ${failed} did not finish, so only the written requirements were compared.`;
  } else if (a.meetsOwnRequirement && !a.meetsOtherRequirement && b.meetsOwnRequirement && !b.meetsOtherRequirement) {
    verdict = "proven";
    summary = `Running both changes on ${input}: "${a.requirementTitle}" returns ${describeValue(a.actual)} and "${b.requirementTitle}" returns ${describeValue(b.actual)}. Each change meets its own requirement and breaks the other, so no single version can satisfy both.`;
  } else {
    verdict = "not_reproduced";
    summary = `Both requirements expect different results for ${input} (${describeValue(a.expected)} versus ${describeValue(b.expected)}), so they cannot both hold. The code currently returns ${describeValue(a.actual)} and ${describeValue(b.actual)}, so it does not yet show both behaviors.`;
  }
  return contradictionProofSchema.parse({ version: 1, decisionId, input: structuredClone(plan.input), probe: plan.probe, sides, verdict, summary: summary.slice(0, 2000), executedAt: executedAt.toISOString() });
}
