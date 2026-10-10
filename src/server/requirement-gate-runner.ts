import { evaluateRequirementExample, type RequirementExample } from "../core/decision/requirement-gate.js";
import { parseProbeOutput, type ProbeOutcome } from "../core/decision/contradiction-proof.js";
import type { RequirementCheck } from "../core/types.js";
import { q } from "./shell.js";

export type GateExec = (command: string) => Promise<{ success: boolean; stdout: string }>;

/**
 * Runs each requirement example against the exact candidate commit through the platform probe supervisor
 * (probe-cli.ts), which snapshots the commit and runs the repository's code under the isolated execution
 * boundary with no credentials. Identical code+input pairs are run once.
 */
export async function runRequirementGate(exec: GateExec, input: { platformDir: string; repoDir: string; commit: string; examples: readonly RequirementExample[] }): Promise<RequirementCheck[]> {
  if (!/^[a-f0-9]{40}$/.test(input.commit)) throw new Error("Requirement checks need an exact commit");
  const outcomes = new Map<string, ProbeOutcome>();
  const checks: RequirementCheck[] = [];
  for (const example of input.examples) {
    const request = JSON.stringify({ probe: example.probe, input: example.input });
    let outcome = outcomes.get(request);
    if (!outcome) {
      const run = await exec(`cd ${q(input.platformDir)} && bun src/core/decision/probe-cli.ts ${q(input.repoDir)} ${q(input.commit)} ${q(request)}`);
      outcome = run.success ? parseProbeOutput(run.stdout) : { ok: false, error: "The isolated runner could not start" };
      outcomes.set(request, outcome);
    }
    checks.push(evaluateRequirementExample(example, outcome));
  }
  return checks;
}
