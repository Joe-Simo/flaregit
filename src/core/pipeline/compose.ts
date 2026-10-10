import * as fs from "node:fs";
import { mergeCommitMessage } from "./merge-message.js";
import * as path from "node:path";
import { git, gitOrThrow, PLATFORM_IDENTITY } from "./git.js";

export interface ComposeResult {
  isClean: boolean;
  candidateCommit: string | null;
  compositionMethod?: "clean_git_merge" | "repaired_merge";
  /** Files with unresolved conflict markers (repair scope). */
  conflictingFiles: string[];
  /** Working-tree content with conflict markers, keyed by path, for the repair engine. */
  conflictContents: Record<string, string>;
  mergeBranch: string;
}

/**
 * Compose a candidate from the accepted base using native Git: merge task A, then task B, on top
 * of the exact accepted head. Candidates therefore always descend from the accepted head, even if
 * the tasks were branched from an older base. On conflict the work tree is left with native
 * conflict markers for the repair step.
 */
export function composeCandidateCommits(opts: {
  repoDir: string;
  candidateId: string;
  acceptedBase: string;
  commitA: string;
  commitB: string;
  labelA: string;
  labelB: string;
  /** Plain goals for the merge commit subjects; the labels are used when absent. */
  goalA?: string;
  goalB?: string;
}): ComposeResult {
  const { repoDir, candidateId, acceptedBase, commitA, commitB, labelA, labelB, goalA, goalB } = opts;
  const mergeBranch = `candidate/${candidateId}`;

  git(repoDir, ["merge", "--abort"]);
  gitOrThrow(repoDir, ["reset", "--hard", "--quiet"]);
  gitOrThrow(repoDir, ["clean", "-fdq"]);
  gitOrThrow(repoDir, ["checkout", "--quiet", "-B", mergeBranch, acceptedBase]);

  for (const [commit, label, goal] of [
    [commitA, labelA, goalA],
    [commitB, labelB, goalB],
  ] as const) {
    const merged = git(repoDir, [
      ...PLATFORM_IDENTITY,
      "merge",
      "--no-ff",
      "-m",
      mergeCommitMessage({ goal: goal ?? label, candidateId, taskId: label, commit }),
      commit,
    ]);
    if (!merged.ok) {
      const unmerged = git(repoDir, ["diff", "--name-only", "--diff-filter=U"]).stdout.split("\n").filter(Boolean);
      if (unmerged.length === 0) {
        throw new Error(`git merge of ${label} failed without conflicts: ${merged.stderr.trim()}`);
      }
      const conflictContents: Record<string, string> = {};
      for (const file of unmerged) {
        const full = path.join(repoDir, file);
        conflictContents[file] = fs.existsSync(full) ? fs.readFileSync(full, "utf-8") : "";
      }
      return { isClean: false, candidateCommit: null, conflictingFiles: unmerged, conflictContents, mergeBranch };
    }
  }

  return {
    isClean: true,
    candidateCommit: gitOrThrow(repoDir, ["rev-parse", "HEAD"]),
    compositionMethod: "clean_git_merge",
    conflictingFiles: [],
    conflictContents: {},
    mergeBranch,
  };
}
