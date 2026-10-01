/**
 * Verification entrypoint baked into the integrator container image:
 *   bun src/core/verification/cli.ts <fixture> <repoDir> <candidateCommit> <expectedBase> <policyVersion> <policyJson>
 * Prints the VerificationEvidence JSON. Runs inside the platform-controlled integrator sandbox, never
 * inside a contributor/agent sandbox.
 */
import { ticketBookingVerifier } from "../../fixtures/ticket-booking/verifier.js";
import { shippingVerifier } from "../../fixtures/shipping-calculator/verifier.js";

const [, , fixture, repoDir, candidateCommit, expectedBase, version, policyJson] = process.argv;
const verifier = fixture === "shipping-calculator" ? shippingVerifier : fixture === "ticket-booking" ? ticketBookingVerifier : undefined;
if (!verifier || !repoDir || !candidateCommit || !expectedBase || !version || !policyJson) {
  console.error("usage: cli <ticket-booking|shipping-calculator> <repoDir> <commit> <base> <policyVersion> <policyJson>");
  process.exit(2);
}
const evidence = await verifier.verify({
  repoDir,
  candidateCommit,
  expectedBase,
  requirementsVersion: Number(version),
  policy: JSON.parse(policyJson),
});
console.log(JSON.stringify(evidence));
