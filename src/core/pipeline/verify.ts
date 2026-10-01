import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { CandidateGeneration, VerificationEvidence } from "../types.js";
import { runProtectedVerification } from "../../fixtures/ticket-booking/verifier.js";

export interface VerifyCandidateOptions {
  repoDir: string;
  candidate: CandidateGeneration;
  policy: {
    groupDiscountPercent?: number;
    minTicketsForDiscount?: number;
    refundFeePerTicket?: number;
    discountAppliesToRefundFee?: boolean;
  };
}

export async function verifyCandidateCommit(
  opts: VerifyCandidateOptions
): Promise<{ passed: boolean; evidence: VerificationEvidence }> {
  const { repoDir, candidate, policy } = opts;
  const candidateCommit = candidate.candidateCommit;
  if (!candidateCommit) {
    throw new Error(`Candidate ${candidate.id} has no candidate commit`);
  }

  // 1. Create a fresh isolated verification workspace
  const tempVerifyDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `flaregit-verify-${candidate.id}-`)
  );

  try {
    // 2. Clone repo at exact candidate commit into verification workspace
    const cloneRes = spawnSync("git", [
      "clone",
      "--depth",
      "1",
      repoDir,
      tempVerifyDir,
    ]);
    if (cloneRes.status !== 0) {
      throw new Error(`Verification clone failed: ${cloneRes.stderr.toString()}`);
    }

    spawnSync("git", ["-C", tempVerifyDir, "checkout", candidateCommit]);

    // 3. Inspect candidate pricing module
    const pricingPath = path.join(tempVerifyDir, "src", "pricing.ts");
    let calculateQuoteFn: any;

    if (fs.existsSync(pricingPath)) {
      // Dynamic import of the candidate's exact compiled/ts module via bun
      const mod = await import(pricingPath);
      calculateQuoteFn = mod.calculateQuote;
    }

    if (!calculateQuoteFn) {
      throw new Error("Candidate bundle missing calculateQuote export");
    }

    // Inspect catalog module if present
    const catalogPath = path.join(tempVerifyDir, "src", "catalog.ts");
    let catalogEvents: Array<{ id: string; price: number }> = [];
    if (fs.existsSync(catalogPath)) {
      const catMod = await import(catalogPath);
      catalogEvents = catMod.EVENT_CATALOG || [];
    }

    // 4. Run protected verifier against candidate
    const evidence = runProtectedVerification({
      candidateCommit,
      expectedBase: candidate.expectedAcceptedBase,
      requirementsVersion: candidate.frozenPolicyVersion,
      calculateQuote: calculateQuoteFn,
      catalogEvents,
      policy,
    });

    const passed = evidence.status === "passed";
    return { passed, evidence };
  } finally {
    // Clean up temporary verification workspace
    try {
      fs.rmSync(tempVerifyDir, { recursive: true, force: true });
    } catch {}
  }
}
