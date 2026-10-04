/**
 * Verification entrypoint baked into the integrator container image:
 *   bun src/core/verification/cli.ts <fixture> <repoDir> <candidateCommit> <expectedBase> <policyVersion> <policyJson>
 * Prints the VerificationEvidence JSON. Runs inside the platform-controlled integrator sandbox, never
 * inside a contributor/agent sandbox.
 */
import { z } from "zod";
import { verifyNativeIntegrity } from "./integrity.js";
import { acceptedTargetSchema } from "../accepted-target";
import { ticketBookingVerifier } from "../../fixtures/ticket-booking/verifier.js";
import { createCommandVerifier, isCommandPolicy } from "./command.js";
import { shippingVerifier } from "../../fixtures/shipping-calculator/verifier.js";

if (process.argv[2] === "--native-integrity") {
  const sha = z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/);
  const schema = z.object({
    repoDir: z.string().min(1), candidateCommit: sha, candidateTree: sha, expectedBase: sha.nullable(), acceptedTarget: acceptedTargetSchema.optional(),
    requirementsVersion: z.number().int().positive(), policy: z.record(z.string(), z.unknown()),
    protectedPaths: z.array(z.string()), allowedScope: z.array(z.string()).min(1), landing: z.enum(["merge", "squash"]),
    contributors: z.array(z.object({ id: z.string().min(1), commit: sha, baseCommit: sha.nullable(), ref: z.string().min(1), allowedScope: z.array(z.string()).min(1), stackedOn:z.object({taskId:z.string().min(1),commit:sha,ref:z.string().min(1)}).strict().optional() }).strict()).min(1).max(8),
  }).strict();
  try {
    const input = schema.parse(JSON.parse(process.argv[3] ?? ""));
    console.log(JSON.stringify(await verifyNativeIntegrity(input)));
  } catch {
    console.error("Native integrity input or Git inspection unavailable; no application commands executed");
    process.exitCode = 2;
  }
} else {
const [, , fixture, repoDir, candidateCommit, expectedBase, version, policyJson] = process.argv;
const parsedPolicy = policyJson ? (JSON.parse(policyJson) as unknown) : undefined;
const verifier =
  fixture === "custom" && isCommandPolicy(parsedPolicy)
    ? createCommandVerifier(parsedPolicy)
    : fixture === "shipping-calculator"
      ? shippingVerifier
      : fixture === "ticket-booking"
        ? ticketBookingVerifier
        : undefined;
if (!verifier || !repoDir || !candidateCommit || !expectedBase || !version || !policyJson) {
  console.error("usage: cli <ticket-booking|shipping-calculator|custom> <repoDir> <commit> <base> <policyVersion> <policyJson>");
  process.exit(2);
}
const evidence = await verifier.verify({
  repoDir,
  candidateCommit,
  expectedBase,
  requirementsVersion: Number(version),
  policy: parsedPolicy as Record<string, unknown>,
});
console.log(JSON.stringify(evidence));

}
