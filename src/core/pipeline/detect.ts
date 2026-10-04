import { changedFiles, git, PLATFORM_IDENTITY } from "./git.js";
import type { Task, TestResultItem } from "../types.js";
import type { ProtectedVerifier, VerificationPolicy } from "../verifier.js";

export interface ContractFailure {
  testId: string;
  description: string;
  message?: string;
}

export interface DetectionResult {
  hasConflict: boolean;
  conflictType: "none" | "textual_overlap" | "contract_mismatch" | "both";
  changedFilesByTask: Record<string, string[]>;
  overlappingFiles: string[];
  /** Files Git itself cannot merge (computed with `git merge-tree`). */
  conflictedFiles: string[];
  /** Protected checks / type errors a clean trial merge would introduce. */
  contractFailures: ContractFailure[];
  summary: string;
}

function toFailures(items: TestResultItem[]): ContractFailure[] {
  return items.filter((i) => !i.passed).map((i) => ({ testId: i.testId, description: i.description, message: i.message }));
}

/**
 * Early compatibility analysis. Uses native Git to find real textual conflicts, and for clean
 * merges builds a throwaway trial commit and runs the protected verifier on it, so dependency /
 * interface / behavioral conflicts are detected by execution rather than heuristics.
 */
export async function detectCompatibility(opts: {
  repoDir: string;
  acceptedBase: string;
  taskA: Task;
  taskB: Task;
  verifier: ProtectedVerifier;
  policy: VerificationPolicy;
  requirementsVersion: number;
}): Promise<DetectionResult> {
  const { repoDir, acceptedBase, taskA, taskB } = opts;
  if(!taskA.currentCommit||!taskB.currentCommit)throw new Error("Both contributions need real Git checkpoints before compatibility analysis");
  const filesA = changedFiles(repoDir, acceptedBase, taskA.currentCommit);
  const filesB = changedFiles(repoDir, acceptedBase, taskB.currentCommit);
  const setB = new Set(filesB);
  const overlappingFiles = filesA.filter((f) => setB.has(f));

  const mergeTree = git(repoDir, [
    "merge-tree",
    "--write-tree",
    "--name-only",
    `--merge-base=${acceptedBase}`,
    taskA.currentCommit,
    taskB.currentCommit,
  ]);

  let conflictedFiles: string[] = [];
  let contractFailures: ContractFailure[] = [];

  if (!mergeTree.ok) {
    // Output: <tree oid>\n<conflicted file names...>\n\n<informational messages>
    const [, ...rest] = mergeTree.stdout.split("\n");
    const names: string[] = [];
    for (const line of rest) {
      if (line === "") break;
      names.push(line);
    }
    conflictedFiles = [...new Set(names)];
  } else {
    const tree = mergeTree.stdout.trim().split("\n")[0]!;
    const trial = git(repoDir, [
      ...PLATFORM_IDENTITY,
      "commit-tree",
      tree,
      "-p",
      taskA.currentCommit,
      "-p",
      taskB.currentCommit,
      "-m",
      "FlareGit trial merge (analysis only)",
    ]);
    if (trial.ok) {
      const evidence = await opts.verifier.verify({
        repoDir,
        candidateCommit: trial.stdout.trim(),
        expectedBase: acceptedBase,
        requirementsVersion: opts.requirementsVersion,
        policy: opts.policy,
      });
      contractFailures = toFailures(evidence.testResults.flatMap((s) => s.items));
    }
  }

  const textual = conflictedFiles.length > 0;
  const contract = contractFailures.length > 0;
  const conflictType: DetectionResult["conflictType"] =
    textual && contract ? "both" : textual ? "textual_overlap" : contract ? "contract_mismatch" : "none";

  const summary =
    conflictType === "none"
      ? "Compatible: Git merges cleanly and the trial merge passes protected verification."
      : conflictType === "textual_overlap"
        ? `Git cannot merge ${conflictedFiles.join(", ")} automatically.`
        : `Git merges cleanly but the combined application fails ${contractFailures.map((f) => f.testId).join(", ")}.`;

  return {
    hasConflict: conflictType !== "none",
    conflictType,
    changedFilesByTask: { [taskA.id]: filesA, [taskB.id]: filesB },
    overlappingFiles,
    conflictedFiles,
    contractFailures,
    summary,
  };
}
