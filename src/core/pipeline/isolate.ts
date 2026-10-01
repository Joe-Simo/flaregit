import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ArtifactsClient } from "../../artifacts/types.js";
import type { Task, TaskWorkspace } from "../types.js";

export interface IsolateTaskOptions {
  projectId: string;
  taskId: string;
  goal: string;
  contributorName: string;
  contributorType: "human" | "agent";
  canonicalRepoName: string;
  baseCommit: string;
  allowedScope?: string[];
  workspacesDir?: string;
}

export async function isolateTaskWorkspace(
  artifacts: ArtifactsClient,
  opts: IsolateTaskOptions
): Promise<Task> {
  const workspacesDir =
    opts.workspacesDir ??
    path.resolve(process.cwd(), ".flaregit-workspace", "tasks", opts.taskId);

  if (fs.existsSync(workspacesDir)) {
    fs.rmSync(workspacesDir, { recursive: true, force: true });
  }
  fs.mkdirSync(workspacesDir, { recursive: true });

  // 1. Fork canonical repository via Artifacts client
  const canonicalHandle = await artifacts.get(opts.canonicalRepoName);
  const taskRepoName = `task-${opts.taskId}`;
  const forkMeta = await canonicalHandle.fork(taskRepoName, {
    description: `Workspace for task ${opts.taskId}: ${opts.goal}`,
  });

  // 2. Clone the task repository into the isolated local workspace path
  const cloneRes = spawnSync("git", ["clone", forkMeta.remote, workspacesDir]);
  if (cloneRes.status !== 0) {
    throw new Error(`Failed to clone task workspace: ${cloneRes.stderr.toString()}`);
  }

  // 3. Check out the specific baseCommit
  const checkoutRes = spawnSync("git", [
    "-C",
    workspacesDir,
    "checkout",
    "-B",
    `task/${opts.taskId}`,
    opts.baseCommit,
  ]);
  if (checkoutRes.status !== 0) {
    throw new Error(`Failed to checkout base commit ${opts.baseCommit}: ${checkoutRes.stderr.toString()}`);
  }

  // Configure author for this isolated workspace
  spawnSync("git", [
    "-C",
    workspacesDir,
    "config",
    "user.name",
    opts.contributorName,
  ]);
  spawnSync("git", [
    "-C",
    workspacesDir,
    "config",
    "user.email",
    `${opts.taskId}@flaregit.local`,
  ]);

  const workspace: TaskWorkspace = {
    repoName: taskRepoName,
    remote: forkMeta.remote,
    token: forkMeta.token,
    branch: `task/${opts.taskId}`,
    localPath: workspacesDir,
  };

  const task: Task = {
    id: opts.taskId,
    goal: opts.goal,
    contributor: {
      id: `contrib-${opts.taskId}`,
      name: opts.contributorName,
      type: opts.contributorType,
    },
    baseCommit: opts.baseCommit,
    allowedScope: opts.allowedScope ?? ["src/**/*"],
    status: "working",
    requirements: [],
    workspace,
    checkpoints: [],
    currentCommit: opts.baseCommit,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return task;
}
