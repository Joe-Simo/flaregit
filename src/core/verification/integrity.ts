import { createHash, randomUUID } from "node:crypto";
import { assertAgentWrites } from "../../agents/prompt.js";
import { git } from "../pipeline/git.js";
import type { TestResultItem, VerificationEvidence } from "../types.js";
import { acceptedTargetSchema, assertCompatibleAcceptedTargetBatch, type FrozenAcceptedTarget } from "../accepted-target";

export const NATIVE_INTEGRITY_IDENTITY = "flaregit-native-integrity-v1";
export interface FrozenContributorProof {
  id: string;
  commit: string;
  baseCommit: string | null;
  /** Platform-owned fetched ref, whose head must still equal the frozen checkpoint. */
  ref: string;
  allowedScope: string[];
  /** Before first acceptance, a child base is a frozen contributor checkpoint, never accepted history. */
  stackedOn?: { taskId: string; commit: string; ref: string };
}
export interface NativeIntegrityInput {
  repoDir: string;
  candidateCommit: string;
  candidateTree: string;
  expectedBase: string | null;
  acceptedTarget?: FrozenAcceptedTarget;
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
    const unborn = input.expectedBase === null;
    prove([input.candidateCommit, input.candidateTree].every((value) => sha.test(value)), "Exact candidate and tree hashes required");
    if (unborn) {
      const target = acceptedTargetSchema.parse(input.acceptedTarget);
      prove(target.kind === "unborn" && target.acceptedCommit === null, "Missing base requires a recorded unborn accepted target");
      assertCompatibleAcceptedTargetBatch([target, {...target, policyVersion:input.requirementsVersion, policy:input.policy}]);
      prove(input.landing === "merge", "First-root verification preserves actual contributor ancestry");
    } else prove(sha.test(input.expectedBase!), "Exact accepted base hash required");
    prove(Number.isSafeInteger(input.requirementsVersion) && input.requirementsVersion > 0, "Invalid frozen policy version");
    prove(input.contributors.length > 0 && input.contributors.length <= 8 && new Set(input.contributors.map((p) => p.id)).size === input.contributors.length, "One to eight distinct frozen contributors required");
    if(unborn)for(const contributor of input.contributors){
      let current=contributor;const visited=new Set<string>();
      while(current.baseCommit!==null){
        prove(!visited.has(current.id),"Initial contributor dependency cycle refused");visited.add(current.id);
        const parent=current.stackedOn&&input.contributors.find(proof=>proof.id===current.stackedOn!.taskId);
        prove(Boolean(parent),"Initial stacked change requires a frozen parent in the batch");current=parent!;
      }
    }
    tree = inspect(["rev-parse", "--verify", `${input.candidateCommit}^{tree}`]).trim();
    prove(tree === input.candidateTree, "Candidate tree differs from frozen tree");
    prove(inspect(["rev-parse", "--verify", `${input.candidateCommit}^{commit}`]).trim() === input.candidateCommit, "Candidate is not the exact commit object");
    if (!unborn) inspect(["merge-base", "--is-ancestor", input.expectedBase!, input.candidateCommit]);
    inspect(["fsck", "--strict", "--full", "--no-reflogs", "--no-dangling", input.candidateCommit]);
    const paths = (base: string | null, commit: string) => inspect(base === null ? ["ls-tree", "-r", "--name-only", "-z", commit] : ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", base, commit, "--"]).split("\0").filter(Boolean);
    const contributorRoots = new Set<string>();
    for (const contributor of input.contributors) {
      prove(sha.test(contributor.commit) && (unborn ? contributor.baseCommit === null || typeof contributor.baseCommit === "string" && sha.test(contributor.baseCommit) : typeof contributor.baseCommit === "string" && sha.test(contributor.baseCommit)), "Invalid contributor commit identity");
      prove(/^refs\/flaregit\/[A-Za-z0-9_/-]+$/.test(contributor.ref) && !contributor.ref.includes("..") && !contributor.ref.includes("//"), "Contributor proof requires a platform-owned safe ref");
      prove(inspect(["rev-parse", "--verify", `${contributor.ref}^{commit}`]).trim() === contributor.commit, "Contributor ref differs from frozen checkpoint");
      if (unborn) {
        if(contributor.baseCommit!==null){
          const stack=contributor.stackedOn,parent=stack&&input.contributors.find(proof=>proof.id===stack.taskId);
          prove(Boolean(stack&&parent&&parent.id!==contributor.id&&stack.commit===contributor.baseCommit&&parent.commit===stack.commit&&parent.ref===stack.ref),"Initial stacked change requires its exact frozen parent in the same batch");
          inspect(["merge-base","--is-ancestor",contributor.baseCommit,contributor.commit]);
        }else prove(contributor.stackedOn===undefined,"Initial root contribution cannot claim a parent checkpoint");
        const roots = inspect(["rev-list", "--max-parents=0", contributor.commit]).trim().split("\n");
        prove(roots.length === 1 && sha.test(roots[0]!), "Initial contributor must preserve one genuine root lineage");
        contributorRoots.add(roots[0]!);
      } else inspect(["merge-base", "--is-ancestor", contributor.baseCommit!, contributor.commit]);
      if (input.landing === "merge") inspect(["merge-base", "--is-ancestor", contributor.commit, input.candidateCommit]);
      const changed = paths(contributor.baseCommit, contributor.commit);
      assertAgentWrites({ allowedScope: contributor.allowedScope }, changed, input.protectedPaths);
      assertAgentWrites({ allowedScope: input.allowedScope }, changed, input.protectedPaths);
    }
    if (unborn) {
      const roots = inspect(["rev-list", "--max-parents=0", input.candidateCommit]).trim().split("\n");
      prove(roots.length === contributorRoots.size && roots.every(root => contributorRoots.has(root)), "Candidate includes an unfrozen initial root lineage");
    }
    const finalPaths = paths(input.expectedBase, input.candidateCommit);
    assertAgentWrites({ allowedScope: input.allowedScope }, finalPaths, input.protectedPaths);
    assertAgentWrites({ allowedScope: input.contributors.flatMap((proof) => proof.allowedScope) }, finalPaths, input.protectedPaths);
    items.push({ testId: "NATIVE-GIT-INTEGRITY", description: input.policy.kind === "git-integrity" ? "Exact Git objects, frozen contributor refs, ancestry and protected scope verified; application behavior checks are not configured by this policy" : "Exact Git objects, frozen contributor refs, ancestry and protected scope verified; application CI is external and not evaluated", passed: true, durationMs: Date.now() - started });
  } catch (error) {
    items.push({ testId: "NATIVE-GIT-INTEGRITY", description: "Native Git integrity only; no application commands executed", passed: false, message: error instanceof Error ? error.message : "Native inspection failed", durationMs: Date.now() - started });
  }
  const passed = items.every((item) => item.passed);
  return {
    id: `ev_${randomUUID().slice(0, 12)}`, candidateCommit: input.candidateCommit, candidateTree: tree,
    expectedAcceptedBase: input.expectedBase, ...(input.acceptedTarget ? {acceptedTarget:structuredClone(input.acceptedTarget)} : {}), requirementsVersion: input.requirementsVersion, policy: input.policy,
    testBundleDigest: hash(JSON.stringify({ identity: NATIVE_INTEGRITY_IDENTITY, acceptedTarget: input.acceptedTarget, protectedPaths: input.protectedPaths, allowedScope: input.allowedScope, contributors: input.contributors, landing: input.landing })),
    toolchainDigest: hash(git(input.repoDir, ["--version"]).stdout.trim() || "git-version-unavailable"), builtOutputDigest: hash(`not-built:git-tree:${tree}`), verifierIdentity: NATIVE_INTEGRITY_IDENTITY,
    testResults: [{ suite: "NativeGitIntegrityOnly", passed, passedCount: passed ? 1 : 0, failedCount: passed ? 0 : 1, items }],
    timestamp: new Date().toISOString(), status: passed ? "passed" : "failed",
  };
}
