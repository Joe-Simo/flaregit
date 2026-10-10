import type { Requirement, RequirementAssertion, RequirementCheck } from "../types.js";
import { findContradiction } from "./contradiction.js";
import { describeValue, matchesExpected, requirementProbeSchema, type ProbeOutcome, type RequirementProbe } from "./contradiction-proof.js";

/**
 * Requirement gate: before a combined preview can be accepted, the runnable examples of every requirement
 * that must hold (requirements chosen in product decisions plus the approved requirements frozen with the
 * candidate) are executed against the exact candidate commit. A failing example blocks acceptance.
 */

/** Requirements chosen in resolved decisions, and the requirements those choices replaced. */
export interface DecidedRequirements {
  active: Requirement[];
  supersededIds: string[];
}

export interface RequirementExample {
  requirementId: string;
  requirementTitle: string;
  assertionId: string;
  description: string;
  decided: boolean;
  input: Record<string, unknown>;
  expected: unknown;
  probe: RequirementProbe;
}

function probeOf(assertion: RequirementAssertion): RequirementProbe | null {
  if (assertion.probe === undefined) return null;
  const parsed = requirementProbeSchema.safeParse(assertion.probe);
  return parsed.success ? parsed.data : null;
}

/**
 * True when `requirement` is the same requirement as `winner`, or demands a different result than `winner`
 * for the identical input of the identical code entry point. Either way the winner replaces it.
 */
export function replacedBy(requirement: Requirement, winner: Requirement): boolean {
  if (requirement.id === winner.id) return false;
  const found = findContradiction(requirement, winner);
  if (!found) return false;
  const a = found.assertionA.probe, b = found.assertionB.probe;
  return a === undefined || b === undefined ? a === b : a.module === b.module && a.export === b.export;
}

/**
 * The requirements a candidate must satisfy: every decided requirement, plus the candidate's approved
 * requirements that no decision replaced. A replaced requirement still carried by a change is not run;
 * the decided requirement that replaced it is, so an unrevised change fails with the decided behavior.
 */
export function gateRequirements(frozen: readonly Requirement[], decided: DecidedRequirements): Array<{ requirement: Requirement; decided: boolean }> {
  const superseded = new Set(decided.supersededIds);
  const chosen = decided.active.filter((requirement) => !superseded.has(requirement.id));
  const rows = chosen.map((requirement) => ({ requirement, decided: true }));
  for (const requirement of frozen) {
    if (requirement.status !== "approved" || superseded.has(requirement.id) || rows.some((row) => row.requirement.id === requirement.id)) continue;
    if (chosen.some((winner) => replacedBy(requirement, winner))) continue;
    rows.push({ requirement, decided: false });
  }
  return rows;
}

/** Every assertion that names code, an input and an expected result can be run. */
export function requirementExamples(frozen: readonly Requirement[], decided: DecidedRequirements): RequirementExample[] {
  return gateRequirements(frozen, decided).flatMap(({ requirement, decided: isDecided }) =>
    requirement.assertions.flatMap((assertion): RequirementExample[] => {
      const probe = probeOf(assertion);
      if (!probe || !assertion.input || assertion.expectedOutput === undefined) return [];
      return [{ requirementId: requirement.id, requirementTitle: requirement.title.slice(0, 500), assertionId: assertion.id, description: assertion.description.slice(0, 500), decided: isDecided, input: structuredClone(assertion.input), expected: structuredClone(assertion.expectedOutput), probe }];
    }),
  );
}

/** Only the fields the requirement talks about are kept, never a whole module result. */
function projected(actual: unknown, expected: unknown): unknown {
  if (!actual || typeof actual !== "object" || Array.isArray(actual) || !expected || typeof expected !== "object" || Array.isArray(expected)) return actual;
  return Object.fromEntries(Object.keys(expected).filter((key) => Object.hasOwn(actual, key)).map((key) => [key, (actual as Record<string, unknown>)[key]]));
}

export function evaluateRequirementExample(example: RequirementExample, outcome: ProbeOutcome): RequirementCheck {
  const kind = example.decided ? "decided requirement" : "approved requirement";
  const base = { requirementId: example.requirementId, requirementTitle: example.requirementTitle, assertionId: example.assertionId, decided: example.decided, input: example.input, expected: example.expected };
  if (!outcome.ok) {
    const error = outcome.error.slice(0, 500);
    return { ...base, error, passed: false, reason: `The ${kind} “${example.requirementTitle}” could not be checked: running the code for ${describeValue(example.input)} failed (${error}).` };
  }
  const actual = projected(outcome.output, example.expected);
  if (matchesExpected(outcome.output, example.expected)) return { ...base, actual, passed: true };
  return { ...base, actual, passed: false, reason: `This change breaks the ${kind} “${example.requirementTitle}”: ${describeValue(example.input)} should give ${describeValue(example.expected)}, the code returns ${describeValue(actual)}.` };
}

/** The first failure, in plain words, or null when every check passed. */
export function requirementGateFailure(checks: readonly RequirementCheck[]): string | null {
  const failed = checks.filter((check) => !check.passed);
  if (!failed.length) return null;
  const more = failed.length > 1 ? ` ${failed.length - 1} more requirement check${failed.length === 2 ? "" : "s"} also failed.` : "";
  return `${failed[0]!.reason ?? `The requirement “${failed[0]!.requirementTitle}” is not met.`}${more}`;
}
