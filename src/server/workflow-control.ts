import type { Env } from "./env.js";

export type WorkflowAction = "status" | "pause" | "resume";
export interface OwnedWorkflow { kind: "agent" | "integration" | "scenario"; instanceId: string; actorId?: string | null }
export class WorkflowControlError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); }
}

export function assertWorkflowControlPermission(owned: OwnedWorkflow, userId: string, isOwner: boolean): void {
  if (!isOwner && !(owned.kind === "agent" && owned.actorId === userId)) throw new WorkflowControlError("Only the run's initiator or repository owner can control it", 403);
}

/** Ownership comes only from this repository's durable ledger, never an ID substring. */
export async function controlWorkflow(
  env: Pick<Env, "AGENT_WORKFLOW" | "INTEGRATION_WORKFLOW" | "SCENARIO_WORKFLOW">,
  ledger: { getWorkflowRun(id: string): Promise<OwnedWorkflow | null> },
  instanceId: string,
  action: WorkflowAction,
) {
  const owned = await ledger.getWorkflowRun(instanceId);
  if (!owned || owned.instanceId !== instanceId) throw new WorkflowControlError("Workflow not found in this repository", 404);
  const binding = owned.kind === "agent" ? env.AGENT_WORKFLOW : owned.kind === "scenario" ? env.SCENARIO_WORKFLOW : env.INTEGRATION_WORKFLOW;
  let instance: WorkflowInstance;
  let current: InstanceStatus;
  try {
    instance = await binding.get(owned.instanceId);
    current = await instance.status();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/not found|does not exist|no such instance/i.test(message)) throw new WorkflowControlError("Saved workflow is not available; inspect the change before starting a new run", 404);
    throw new WorkflowControlError("Workflow status is temporarily unavailable; retry without starting a new run", 503);
  }
  let changed = false;
  if (action === "pause" && !["paused", "waitingForPause"].includes(current.status)) {
    if (!["running", "waiting", "queued"].includes(current.status)) throw new WorkflowControlError(`Cannot pause a ${current.status} workflow`, 409);
    await instance.pause();
    changed = true;
  }
  if (action === "resume" && current.status === "paused") {
    await instance.resume();
    changed = true;
  } else if (action === "resume" && !["running", "waiting", "queued"].includes(current.status)) {
    throw new WorkflowControlError(`Cannot resume a ${current.status} workflow`, 409);
  }
  if (changed) current = await instance.status();
  // Provider output/error payloads can contain repository contents or credentials.
  return { instanceId: owned.instanceId, kind: owned.kind, status: current.status, action, changed };
}
