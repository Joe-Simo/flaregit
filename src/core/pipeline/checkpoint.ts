import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import type { Checkpoint, Task } from "../types.js";

export interface RecordCheckpointOptions {
  task: Task;
  message?: string;
  isReadyForIntegration: boolean;
}

export function recordCheckpoint(opts: RecordCheckpointOptions): {
  task: Task;
  checkpoint: Checkpoint;
} {
  const { task } = opts;
  const workspacePath = task.workspace.localPath;
  if (!workspacePath) {
    throw new Error(`Task ${task.id} has no local workspace path`);
  }

  // 1. Stage changes if any unstaged
  spawnSync("git", ["-C", workspacePath, "add", "-A"]);

  // 2. Check if there are changes to commit
  const statusRes = spawnSync("git", ["-C", workspacePath, "status", "--porcelain"]);
  const hasChanges = statusRes.stdout.toString().trim().length > 0;

  let commitHash: string;
  let commitMessage = opts.message ?? (opts.isReadyForIntegration ? "Ready for integration" : "Work in progress");

  if (hasChanges) {
    const commitRes = spawnSync("git", [
      "-C",
      workspacePath,
      "commit",
      "-m",
      commitMessage,
    ]);
    if (commitRes.status !== 0) {
      throw new Error(`Git commit failed: ${commitRes.stderr.toString()}`);
    }
  }

  // 3. Get current HEAD hash
  const revParse = spawnSync("git", ["-C", workspacePath, "rev-parse", "HEAD"]);
  commitHash = revParse.stdout.toString().trim();

  // 4. Get list of changed files relative to base commit
  const diffTree = spawnSync("git", [
    "-C",
    workspacePath,
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    task.baseCommit,
    commitHash,
  ]);
  const filesChanged = diffTree.stdout
    .toString()
    .trim()
    .split("\n")
    .filter((f) => f.length > 0);

  // 5. Push to task remote
  spawnSync("git", [
    "-C",
    workspacePath,
    "push",
    "origin",
    `${task.workspace.branch}:${task.workspace.branch}`,
  ]);

  const checkpoint: Checkpoint = {
    id: `chk_${crypto.randomUUID().slice(0, 8)}`,
    commitHash,
    author: task.contributor.name,
    message: commitMessage,
    timestamp: new Date().toISOString(),
    isReadyForIntegration: opts.isReadyForIntegration,
    filesChanged,
  };

  const updatedCheckpoints = [...task.checkpoints, checkpoint];
  const updatedTask: Task = {
    ...task,
    currentCommit: commitHash,
    checkpoints: updatedCheckpoints,
    status: opts.isReadyForIntegration ? "ready" : "checkpointed",
    updatedAt: new Date().toISOString(),
  };

  return { task: updatedTask, checkpoint };
}
