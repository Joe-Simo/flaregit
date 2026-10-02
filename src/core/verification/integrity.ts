import { createHash, randomUUID } from "node:crypto";
import { assertAgentWrites } from "../../agents/prompt.js";
import { git } from "../pipeline/git.js";
import type { TestResultItem, VerificationEvidence } from "../types.js";

export const NATIVE_INTEGRITY_IDENTITY = "flaregit-native-integrity-v1";
export interface FrozenContributorProof {
  id: string;
  commit: string;
  baseCommit: string;
  /** Platform-owned fetched ref, whose head must still equal the frozen checkpoint. */
  ref: string;
  allowedScope: string[];
}
export interface NativeIntegrityInput {
  repoDir: string;
  candidateCommit: string;
  candidateTree: string;
  expectedBase: string;
  requirementsVersion: number;
  policy: Record<string, unknown>;
  protectedPaths: string[];
  allowedScope: string[];
  contributors: FrozenContributorProof[];
  /** Squash deliberately changes ancestry; original contributor refs remain separately proved. */
  landing: "merge" | "squash";
}

/** Inspects native Git objects only. No checkout, source evaluation, hooks, install,
 * customer tests or builds. A pass proves Git integrity, never application behavior;
 * external CI and human review must independently authorize publication.
 */
export async function verifyNativeIntegrity(input: NativeIntegrityInput): Promise<VerificationEvidence> {
  const started = Date.now();
  const items: TestResultItem[] = [];
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const inspect = (args: string[]) => {
    const result = git(input.repoDir, ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args]);
    if (!result.ok) throw new Error("Native Git inspection refused or object data unavailable");
    return result.stdout;
  };
  const prove = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  const sha = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
  let tree = input.candidateTree;
  try {
    prove([input.candidateCommit, input.candidateTree, input.expectedBase].every((value) => sha.test(value)), "Exact candidate, tree and base hashes required");
    prove(Number.isSafeInteger(input.requirementsVersion) && input.requirementsVersion > 0, "Invalid frozen policy version");
    prove(input.contributors.length > 0 && input.contributors.length <= 8 && new Set(input.contributors.map((p) => p.id)).size === input.contributors.length, "One to eight distinct frozen contributors required");
    tree = inspect(["rev-parse", "--verify", `${input.candidateCommit}^{tree}`]).trim();
    prove(tree === input.candidateTree, "Candidate tree differs from frozen tree");
    prove(inspect(["rev-parse", "--verify", `${input.candidateCommit}^{commit}`]).trim() === input.candidateCommit, "Candidate is not the exact commit object");
    inspect(["merge-base", "--is-ancestor", input.expectedBase, input.candidateCommit]);
    inspect(["fsck", "--strict", "--full", "--no-reflogs", "--no-dangling", input.candidateCommit]);
    const paths = (base: string, commit: string) => inspect(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", base, commit, "--"]).split("\0").filter(Boolean);
    for (const contributor of input.contributors) {
      prove(sha.test(contributor.commit) && sha.test(contributor.baseCommit), "Invalid contributor commit identity");
      prove(/^refs\/flaregit\/[A-Za-z0-9_/-]+$/.test(contributor.ref) && !contributor.ref.includes("..") && !contributor.ref.includes("//"), "Contributor proof requires a platform-owned safe ref");
      prove(inspect(["rev-parse", "--verify", `${contributor.ref}^{commit}`]).trim() === contributor.commit, "Contributor ref differs from frozen checkpoint");
      inspect(["merge-base", "--is-ancestor", contributor.baseCommit, contributor.commit]);
      if (input.landing === "merge") inspect(["merge-base", "--is-ancestor", contributor.commit, input.candidateCommit]);
      const changed = paths(contributor.baseCommit, contributor.commit);
      assertAgentWrites({ allowedScope: contributor.allowedScope }, changed, input.protectedPaths);
      assertAgentWrites({ allowedScope: input.allowedScope }, changed, input.protectedPaths);
    }
    const finalPaths = paths(input.expectedBase, input.candidateCommit);
    assertAgentWrites({ allowedScope: input.allowedScope }, finalPaths, input.protectedPaths);
    assertAgentWrites({ allowedScope: input.contributors.flatMap((proof) => proof.allowedScope) }, finalPaths, input.protectedPaths);
    items.push({ testId: "NATIVE-GIT-INTEGRITY", description: "Exact Git objects, frozen contributor refs, ancestry and protected scope verified; application CI is external and not evaluated", passed: true, durationMs: Date.now() - started });
  } catch (error) {
    items.push({ testId: "NATIVE-GIT-INTEGRITY", description: "Native Git integrity only; no application commands executed", passed: false, message: error instanceof Error ? error.message : "Native inspection failed", durationMs: Date.now() - started });
  }
  const passed = items.every((item) => item.passed);
  return {
    id: `ev_${randomUUID().slice(0, 12)}`, candidateCommit: input.candidateCommit, candidateTree: tree,
    expectedAcceptedBase: input.expectedBase, requirementsVersion: input.requirementsVersion, policy: input.policy,
    testBundleDigest: hash(JSON.stringify({ identity: NATIVE_INTEGRITY_IDENTITY, protectedPaths: input.protectedPaths, allowedScope: input.allowedScope, contributors: input.contributors, landing: input.landing })),
    toolchainDigest: hash(git(input.repoDir, ["--version"]).stdout.trim() || "git-version-unavailable"), builtOutputDigest: hash(`not-built:git-tree:${tree}`), verifierIdentity: NATIVE_INTEGRITY_IDENTITY,
    testResults: [{ suite: "NativeGitIntegrityOnly", passed, passedCount: passed ? 1 : 0, failedCount: passed ? 0 : 1, items }],
    timestamp: new Date().toISOString(), status: passed ? "passed" : "failed",
  };
}
