import { spawnSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

export interface ComposeResult {
  success: boolean;
  isClean: boolean;
  candidateCommit: string | null;
  compositionMethod?: "clean_git_merge" | "repaired_merge";
  conflictingFiles: string[];
  conflictDiff: string | null;
  mergeBranch: string;
}

export function composeCandidateCommits(
  repoDir: string,
  candidateId: string,
  baseCommit: string,
  commitA: string,
  commitB: string,
  taskA_name: string,
  taskB_name: string,
  sourceB?: string
): ComposeResult {
  const mergeBranch = `candidate/${candidateId}`;

  // 1. Fetch sourceB into repoDir so commitB is known locally
  if (sourceB) {
    spawnSync("git", ["-C", repoDir, "fetch", sourceB]);
  }

  // 2. Ensure working directory is clean
  spawnSync("git", ["-C", repoDir, "reset", "--hard", "HEAD"]);
  spawnSync("git", ["-C", repoDir, "clean", "-fd"]);

  // 3. Checkout branch from commitA
  const checkoutRes = spawnSync("git", [
    "-C",
    repoDir,
    "checkout",
    "-B",
    mergeBranch,
    commitA,
  ]);
  if (checkoutRes.status !== 0) {
    throw new Error(`Failed to checkout ${commitA}: ${checkoutRes.stderr.toString()}`);
  }

  // 4. Attempt native Git merge with commitB
  const mergeRes = spawnSync("git", [
    "-C",
    repoDir,
    "-c",
    "user.name=FlareGit Publisher",
    "-c",
    "user.email=publisher@flaregit.local",
    "merge",
    "--no-commit",
    commitB,
  ]);

  if (mergeRes.status === 0) {
    // Clean merge! Commit it now
    const commitMsg = `FlareGit Candidate ${candidateId}: Merge ${taskA_name} (${commitA.slice(0, 7)}) and ${taskB_name} (${commitB.slice(0, 7)})`;
    const finalCommit = spawnSync("git", [
      "-C",
      repoDir,
      "-c",
      "user.name=FlareGit Publisher",
      "-c",
      "user.email=publisher@flaregit.local",
      "commit",
      "-m",
      commitMsg,
    ]);

    const revParse = spawnSync("git", ["-C", repoDir, "rev-parse", "HEAD"]);
    const candidateCommit = revParse.stdout.toString().trim();

    return {
      success: true,
      isClean: true,
      candidateCommit,
      compositionMethod: "clean_git_merge",
      conflictingFiles: [],
      conflictDiff: null,
      mergeBranch,
    };
  }

  // Conflict occurred! Inspect conflicting files
  const statusRes = spawnSync("git", ["-C", repoDir, "status", "--porcelain"]);
  const statusLines = statusRes.stdout.toString().split("\n");
  const conflictingFiles: string[] = [];

  for (const line of statusLines) {
    // "UU path/to/file" indicates unmerged / both modified
    if (
      line.startsWith("UU ") ||
      line.startsWith("AA ") ||
      line.startsWith("DU ") ||
      line.startsWith("UD ") ||
      line.startsWith("M  ") ||
      line.startsWith(" M ")
    ) {
      const file = line.slice(3).trim();
      if (file && !conflictingFiles.includes(file)) {
        conflictingFiles.push(file);
      }
    }
  }

  // Also check git diff for conflict markers (<<<<<<<)
  const diffRes = spawnSync("git", ["-C", repoDir, "diff"]);
  const conflictDiff = diffRes.stdout.toString();

  // If no files were caught by status, extract from diff
  if (conflictingFiles.length === 0) {
    const diffFiles = conflictDiff
      .split("\n")
      .filter((l) => l.startsWith("diff --git a/"))
      .map((l) => l.split(" ")[2]!.replace(/^a\//, ""));
    for (const df of diffFiles) {
      if (!conflictingFiles.includes(df)) conflictingFiles.push(df);
    }
  }

  return {
    success: false,
    isClean: false,
    candidateCommit: null,
    conflictingFiles,
    conflictDiff,
    mergeBranch,
  };
}
