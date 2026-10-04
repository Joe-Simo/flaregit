import fs from "node:fs";
import path from "node:path";
import { git, gitOrThrow } from "./git";

/** Missing history is explicit; it is never represented by a fabricated commit hash. */
export interface UnbornRepositoryBaseline {
  kind: "unborn";
  canonicalRepoName: string;
  providerRepoId: string;
  repositoryIncarnation: string;
  defaultRef: string;
  expectedHead: null;
}
export interface UnbornRootCandidate {
  candidateId: string;
  baseline: UnbornRepositoryBaseline;
  commit: string;
  tree: string;
  /** Frozen contributor checkpoints for an initial batch; omitted for a single root. */
  contributorCommits?: string[];
}
export interface UnbornRootDecision {
  candidateId: string;
  commit: string;
  tree: string;
  actorId: string;
  decision: "approved" | "rejected";
}
export interface UnbornRootVerification { candidateId: string; commit: string; tree: string; passed: boolean }

function validateBaseline(repoDir: string, baseline: UnbornRepositoryBaseline) {
  if (baseline.kind !== "unborn" || baseline.expectedHead !== null || !baseline.canonicalRepoName || !baseline.providerRepoId || !baseline.repositoryIncarnation || !baseline.defaultRef.startsWith("refs/heads/")) throw new Error("Explicit missing repository baseline required");
  gitOrThrow(repoDir, ["check-ref-format", baseline.defaultRef]);
}

/** Local native proof only. Caller must bind the checkout to its authenticated provider ID/incarnation. */
export function inspectUnbornRepository(repoDir: string, baseline: UnbornRepositoryBaseline): { baseline: UnbornRepositoryBaseline; refs: []; headMissing: true } {
  validateBaseline(repoDir, baseline);
  const head = gitOrThrow(repoDir, ["symbolic-ref", "HEAD"], { gitDir: true }).trim();
  const refs = gitOrThrow(repoDir, ["for-each-ref", "--format=%(refname)"], { gitDir: true }).trim();
  if (head !== baseline.defaultRef || refs !== "") throw new Error("Repository is not empty at its recorded default ref");
  return { baseline: structuredClone(baseline), refs: [], headMissing: true };
}

/** Clone empty Git state without creating or claiming accepted history. */
export function createUnbornWorkspace(canonicalDir: string, workspaceDir: string, baseline: UnbornRepositoryBaseline, taskBranch: string): void {
  inspectUnbornRepository(canonicalDir, baseline);
  gitOrThrow(canonicalDir, ["check-ref-format", `refs/heads/${taskBranch}`]);
  if (fs.existsSync(workspaceDir)) throw new Error("Existing workspace must not be replaced");
  fs.mkdirSync(path.dirname(workspaceDir), { recursive: true });
  gitOrThrow(path.dirname(workspaceDir), ["clone", "--quiet", "--no-hardlinks", canonicalDir, workspaceDir]);
  gitOrThrow(workspaceDir, ["checkout", "--quiet", "--orphan", taskBranch]);
}

/** Staged local Git primitive: exact reviewed root publication, atomic create-only CAS. */
export function publishUnbornRoot(canonicalDir: string, workspaceDir: string, candidate: UnbornRootCandidate, decision: UnbornRootDecision, verification: UnbornRootVerification): { accepted: boolean; stale: boolean } {
  validateBaseline(canonicalDir, candidate.baseline);
  if (!candidate.candidateId || !/^[a-f0-9]{40}$/.test(candidate.commit) || !/^[a-f0-9]{40}$/.test(candidate.tree)) throw new Error("Exact root candidate required");
  for (const receipt of [decision, verification]) if (receipt.candidateId !== candidate.candidateId || receipt.commit !== candidate.commit || receipt.tree !== candidate.tree) throw new Error("Review or verification belongs to another root candidate");
  if (decision.decision !== "approved" || !decision.actorId || !verification.passed) throw new Error("Verified human approval required");
  const tree = gitOrThrow(workspaceDir, ["rev-parse", `${candidate.commit}^{tree}`]).trim();
  const contributors = candidate.contributorCommits ?? [candidate.commit], roots = new Set<string>();
  if (!contributors.length || contributors.length > 8 || new Set(contributors).size !== contributors.length) throw new Error("Exact initial contributors required");
  for (const contributor of contributors) {
    if (!/^[a-f0-9]{40}$/.test(contributor)) throw new Error("Invalid initial contributor");
    const lineage = gitOrThrow(workspaceDir, ["rev-list", "--max-parents=0", contributor]).trim().split("\n");
    if (lineage.length !== 1) throw new Error("Initial contributor root lineage differs");
    roots.add(lineage[0]!);gitOrThrow(workspaceDir,["merge-base","--is-ancestor",contributor,candidate.commit]);
  }
  const candidateRoots=gitOrThrow(workspaceDir,["rev-list","--max-parents=0",candidate.commit]).trim().split("\n");
  if (tree !== candidate.tree || candidateRoots.length !== roots.size || candidateRoots.some(root=>!roots.has(root))) throw new Error("Verified initial candidate root lineages or tree differ");
  const observe = () => {
    const inventory = gitOrThrow(canonicalDir, ["for-each-ref", "--format=%(refname) %(objectname)"], { gitDir: true });
    return inventory.split("\n").find(line => line.startsWith(`${candidate.baseline.defaultRef} `))?.split(" ")[1] ?? null;
  };
  if (observe() !== null) return { accepted: false, stale: true };
  // Import objects under a private immutable candidate ref; accepted ref still does not exist.
  const candidateRef = `refs/flaregit/initial/${candidate.commit}`;
  gitOrThrow(canonicalDir, ["fetch", "--quiet", workspaceDir, `${candidate.commit}:${candidateRef}`], { gitDir: true });
  const update = git(canonicalDir, ["update-ref", candidate.baseline.defaultRef, candidate.commit, ""], { gitDir: true });
  if (!update.ok) {
    const observed = observe();
    if (observed === candidate.commit) return { accepted: true, stale: false };
    if (observed !== null) return { accepted: false, stale: true };
    throw new Error("Initial ref publication was not confirmed");
  }
  if (gitOrThrow(canonicalDir, ["rev-parse", candidate.baseline.defaultRef], { gitDir: true }).trim() !== candidate.commit) throw new Error("Initial accepted ref readback is unknown");
  return { accepted: true, stale: false };
}
