import { git, gitOrThrow } from "./git.js";
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

  gitOrThrow(workspacePath, ["add", "-A"]);
  const hasChanges = git(workspacePath, ["status", "--porcelain"]).stdout.trim().length > 0;
  const commitMessage = opts.message ?? (opts.isReadyForIntegration ? "Ready for integration" : "Work in progress");

  if (hasChanges) {
    gitOrThrow(workspacePath, [
      "-c",
      `user.name=${task.contributor.name}`,
      "-c",
      `user.email=${task.id}@agents.flaregit.com`,
      "commit",
      "-m",
      commitMessage,
    ]);
  }

  const commitHash = gitOrThrow(workspacePath, ["rev-parse", "HEAD"]);
  const filesChanged = git(workspacePath, ["diff", "--name-only", `${task.baseCommit}..${commitHash}`])
    .stdout.split("\n")
    .filter(Boolean);

  // The task repository is the source of truth the integrator reads; a failed push must not be silent.
  gitOrThrow(workspacePath, ["push", "--quiet", "origin", `${task.workspace.branch}:${task.workspace.branch}`]);

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
