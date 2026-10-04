import * as fs from "node:fs";
import * as path from "node:path";
import { authArgs, gitOrThrow } from "./git.js";
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
    path.resolve(process.cwd(), ".flaregit-storage", "workspaces", opts.taskId);

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
  try { gitOrThrow(path.dirname(workspacesDir), [...authArgs(forkMeta.remote, forkMeta.token), "clone", "--quiet", forkMeta.remote, workspacesDir]); }
  catch(error){throw new Error(`Failed to clone task workspace: ${error instanceof Error?error.message:"Git clone failed"}`);}
  gitOrThrow(workspacesDir,["checkout","-B",`task/${opts.taskId}`,opts.baseCommit]);
  gitOrThrow(workspacesDir,["config","user.name",opts.contributorName]);
  gitOrThrow(workspacesDir,["config","user.email",`${opts.taskId}@flaregit.local`]);

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
