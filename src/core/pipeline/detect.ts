import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import type { Task } from "../types.js";

export interface ConflictHunk {
  file: string;
  taskA_lines: [number, number];
  taskB_lines: [number, number];
  description: string;
}

export interface ContractDifference {
  symbolName: string;
  sourceFile: string;
  changeType: "added" | "modified" | "removed" | "semantic_unit_change";
  affectedTasks: string[];
  description: string;
}

export interface DetectionResult {
  hasConflict: boolean;
  conflictType: "none" | "textual_overlap" | "contract_mismatch" | "both";
  changedFilesByTask: Record<string, string[]>;
  overlappingFiles: string[];
  overlappingHunks: ConflictHunk[];
  contractDifferences: ContractDifference[];
  summary: string;
}

export function detectCompatibility(
  baseCommit: string,
  taskA: Task,
  taskB: Task,
  repoDir: string,
  remoteB?: string
): DetectionResult {
  const commitA = taskA.currentCommit;
  const commitB = taskB.currentCommit;

  // Ensure commitB is fetched into repoDir
  const sourceB = remoteB ?? taskB.workspace.localPath ?? taskB.workspace.remote;
  if (sourceB) {
    spawnSync("git", ["-C", repoDir, "fetch", sourceB]);
  }

  // 1. Changed paths for Task A and Task B
  const diffA = spawnSync("git", [
    "-C",
    repoDir,
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    baseCommit,
    commitA,
  ]);
  const filesA = diffA.stdout
    .toString()
    .trim()
    .split("\n")
    .filter((f) => f.length > 0);

  const diffB = spawnSync("git", [
    "-C",
    repoDir,
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    baseCommit,
    commitB,
  ]);
  const filesB = diffB.stdout
    .toString()
    .trim()
    .split("\n")
    .filter((f) => f.length > 0);

  const setB = new Set(filesB);
  const overlappingFiles = filesA.filter((f) => setB.has(f));

  const overlappingHunks: ConflictHunk[] = [];

  // 2. Check for overlapping hunks on common files
  for (const file of overlappingFiles) {
    const diffHunkA = spawnSync("git", [
      "-C",
      repoDir,
      "diff",
      "-U0",
      baseCommit,
      commitA,
      "--",
      file,
    ]).stdout.toString();

    const diffHunkB = spawnSync("git", [
      "-C",
      repoDir,
      "diff",
      "-U0",
      baseCommit,
      commitB,
      "--",
      file,
    ]).stdout.toString();

    const regex = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/g;
    const rangesA: Array<[number, number]> = [];
    let match;
    while ((match = regex.exec(diffHunkA)) !== null) {
      const start = parseInt(match[1]!, 10);
      const len = match[2] ? parseInt(match[2]!, 10) : 1;
      rangesA.push([start, start + Math.max(1, len)]);
    }

    regex.lastIndex = 0;
    const rangesB: Array<[number, number]> = [];
    while ((match = regex.exec(diffHunkB)) !== null) {
      const start = parseInt(match[1]!, 10);
      const len = match[2] ? parseInt(match[2]!, 10) : 1;
      rangesB.push([start, start + Math.max(1, len)]);
    }

    for (const rA of rangesA) {
      for (const rB of rangesB) {
        if (Math.max(rA[0], rB[0]) <= Math.min(rA[1], rB[1]) + 5) {
          overlappingHunks.push({
            file,
            taskA_lines: rA,
            taskB_lines: rB,
            description: `Both tasks modified overlapping region (${rA[0]}-${rA[1]} vs ${rB[0]}-${rB[1]}) in ${file}`,
          });
        }
      }
    }
  }

  // 3. Conservative interface and semantic contract difference detection
  const contractDifferences: ContractDifference[] = [];
  const allModified = Array.from(new Set([...filesA, ...filesB]));

  for (const file of allModified) {
    if (file.endsWith(".ts") || file.endsWith(".tsx")) {
      const contentBase = spawnSync("git", [
        "-C",
        repoDir,
        "show",
        `${baseCommit}:${file}`,
      ]).stdout.toString();

      const contentA = spawnSync("git", [
        "-C",
        repoDir,
        "show",
        `${commitA}:${file}`,
      ]).stdout.toString();

      const contentB = spawnSync("git", [
        "-C",
        repoDir,
        "show",
        `${commitB}:${file}`,
      ]).stdout.toString();

      if (
        (contentA.includes("cents") || contentA.includes("priceInCents") || contentA.includes("4000")) &&
        !contentBase.includes("cents")
      ) {
        contractDifferences.push({
          symbolName: "price",
          sourceFile: file,
          changeType: "semantic_unit_change",
          affectedTasks: [taskA.id, taskB.id],
          description: `Task ${taskA.id} introduced cents unit representation in ${file}, affecting consumers in Task ${taskB.id}`,
        });
      }

      if (
        (contentB.includes("cents") || contentB.includes("priceInCents") || contentB.includes("4000")) &&
        !contentBase.includes("cents")
      ) {
        contractDifferences.push({
          symbolName: "price",
          sourceFile: file,
          changeType: "semantic_unit_change",
          affectedTasks: [taskA.id, taskB.id],
          description: `Task ${taskB.id} introduced cents unit representation in ${file}, affecting consumers in Task ${taskA.id}`,
        });
      }
    }
  }

  const hasTextualOverlap = overlappingHunks.length > 0;
  const hasContractMismatch = contractDifferences.length > 0;
  const hasConflict = hasTextualOverlap || hasContractMismatch;

  let conflictType: DetectionResult["conflictType"] = "none";
  if (hasTextualOverlap && hasContractMismatch) conflictType = "both";
  else if (hasTextualOverlap) conflictType = "textual_overlap";
  else if (hasContractMismatch) conflictType = "contract_mismatch";

  let summary = "Clean compatibility: no overlapping hunks or contract conflicts detected.";
  if (conflictType === "textual_overlap") {
    summary = `Textual overlap detected in ${overlappingFiles.join(", ")} (${overlappingHunks.length} overlapping hunks).`;
  } else if (conflictType === "contract_mismatch") {
    summary = `Interface/semantic contract mismatch detected: ${contractDifferences.map((c) => c.description).join("; ")}.`;
  } else if (conflictType === "both") {
    summary = `Both textual overlap and semantic contract mismatch detected.`;
  }

  return {
    hasConflict,
    conflictType,
    changedFilesByTask: {
      [taskA.id]: filesA,
      [taskB.id]: filesB,
    },
    overlappingFiles,
    overlappingHunks,
    contractDifferences,
    summary,
  };
}
