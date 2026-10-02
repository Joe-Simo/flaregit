import * as fs from "node:fs";
import * as path from "node:path";
import { createLocalRuntime } from "../server/runtime.js";
import { ACT1, ACT2, ACT3, runScenario } from "../scenarios/ticket-booking.js";
import { ticketBookingVerifier } from "../fixtures/ticket-booking/verifier.js";
import { WorkersAINotConfiguredError } from "../ai/workers-ai.js";

/**
 * Runs the three scenarios end to end. Agents and repairs are produced by Workers AI at runtime;
 * everything printed is measured from the real controller state — there is no scripted output.
 */
async function main(): Promise<void> {
  const storage = path.resolve(process.cwd(), ".flaregit-storage");
  fs.mkdirSync(storage, { recursive: true });
  const dir = fs.mkdtempSync(path.join(storage, "demo-run-"));
  console.log(`Run receipts and recoverable repositories: ${dir}`);
  const { controller, ai } = await createLocalRuntime(dir);
  if (!ai.isConfigured) throw new WorkersAINotConfiguredError();
  const model = ai.asModel();
  const P = ticketBookingVerifier.protectedPaths;

  for (const [name, specs] of [["Act I (text conflict)", ACT1], ["Act II (clean merge, broken behavior)", ACT2], ["Act III (contradiction)", ACT3]] as const) {
    const r = await runScenario(controller, specs, model, P);
    const o = r.integration;
    console.log(`\n${name}`);
    console.log(`  detection: ${r.detectionSummary}`);
    console.log(`  outcome:   ${o.success ? "ACCEPTED" : o.decision ? "NEEDS DECISION — " + o.decision.question : "BLOCKED — " + o.error}`);
    if (o.candidate) console.log(`  repairs:   ${o.candidate.repairAttempts.length}, evidence: ${o.evidence?.status ?? "n/a"}`);
  }
  const s = controller.getState();
  console.log(`\nAccepted head: ${s.acceptedState.currentCommit}`);
  console.log(`Evidence records: ${Object.keys(s.evidence).length}, journal entries: ${s.journal.length}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
