import {acceptedTargetSchema,type UnbornAcceptedTarget} from "../accepted-target.js";
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
  baseCommit: string | null;
  unbornTarget?: UnbornAcceptedTarget;
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
    throw new Error("Existing workspace must be preserved; recover its original task instead of replacing it");
  }
  fs.mkdirSync(workspacesDir, { recursive: true });

  const unborn=opts.baseCommit===null?acceptedTargetSchema.parse(opts.unbornTarget):undefined;
  if(unborn&&(unborn.kind!=="unborn"||unborn.projectId!==opts.projectId||unborn.canonicalRepoName!==opts.canonicalRepoName))throw Error("Workspace requires its exact recorded unborn target");
  // 1. Fork canonical repository via Artifacts client
  using canonicalHandle = await artifacts.get(opts.canonicalRepoName);
  const taskRepoName = `task-${opts.taskId}`;
  const forkMeta = await canonicalHandle.fork(taskRepoName, {
    description: `Workspace for task ${opts.taskId}: ${opts.goal}`,
    defaultBranchOnly: false,
  });

  if(unborn&&gitOrThrow(path.dirname(workspacesDir),[...authArgs(forkMeta.remote,forkMeta.token),"ls-remote","--refs",forkMeta.remote,unborn.ref])!=="")throw Error("The recorded unborn target already has a Git head");
  // 2. Clone the task repository into the isolated local workspace path
  try { gitOrThrow(path.dirname(workspacesDir), [...authArgs(forkMeta.remote, forkMeta.token), "clone", "--quiet", "--no-checkout", forkMeta.remote, workspacesDir]); }
  catch(error){throw new Error(`Failed to clone task workspace: ${error instanceof Error?error.message:"Git clone failed"}`);}
  if(unborn){gitOrThrow(workspacesDir,["check-ref-format",`refs/heads/task/${opts.taskId}`]);gitOrThrow(workspacesDir,["symbolic-ref","HEAD",`refs/heads/task/${opts.taskId}`]);gitOrThrow(workspacesDir,["read-tree","--empty"]);}
  else if(opts.baseCommit!==null)gitOrThrow(workspacesDir,["checkout","-B",`task/${opts.taskId}`,opts.baseCommit]);
  else throw Error("An unborn workspace requires explicit target coverage");
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
    ...(unborn?.kind==="unborn"?{acceptedTarget:structuredClone(unborn)}:{}),
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
