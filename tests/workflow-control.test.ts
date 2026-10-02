import { expect, test } from "bun:test";
import { assertWorkflowControlPermission, controlWorkflow, type OwnedWorkflow } from "../src/server/workflow-control.js";
import type { Env } from "../src/server/env.js";

function fixture(status: string, owned: OwnedWorkflow | null = { kind: "agent", instanceId: "owned" }) {
  let pauses = 0, resumes = 0, gets = 0;
  const flow = { get: async () => {
    gets++;
    return { status: async () => ({ status, output: "sensitive payload", error: { message: "credential" } }), pause: async () => { pauses++; status = "paused"; }, resume: async () => { resumes++; status = "running"; } };
  } };
  const env = { AGENT_WORKFLOW: flow, INTEGRATION_WORKFLOW: flow, SCENARIO_WORKFLOW: flow } as unknown as Env;
  return { env, ledger: { getWorkflowRun: async () => owned }, counts: () => ({ pauses, resumes, gets }) };
}

test("unowned instance is refused before provider lookup", async () => {
  const f = fixture("running", null);
  await expect(controlWorkflow(f.env, f.ledger, "other-tenant", "pause")).rejects.toThrow("not found");
  expect(f.counts().gets).toBe(0);
});
test("pause and resume use provider controls idempotently and omit payloads", async () => {
  const f = fixture("running");
  expect((await controlWorkflow(f.env, f.ledger, "owned", "pause")).status).toBe("paused");
  expect((await controlWorkflow(f.env, f.ledger, "owned", "pause")).changed).toBe(false);
  const resumed = await controlWorkflow(f.env, f.ledger, "owned", "resume");
  expect(resumed.status).toBe("running");
  expect(resumed).not.toHaveProperty("output");
  expect(resumed).not.toHaveProperty("error");
  await controlWorkflow(f.env, f.ledger, "owned", "resume");
  expect(f.counts()).toEqual({ pauses: 1, resumes: 1, gets: 4 });
});
test("terminal instance cannot be resumed or paused", async () => {
  const f = fixture("complete");
  await expect(controlWorkflow(f.env, f.ledger, "owned", "resume")).rejects.toThrow("Cannot resume");
  await expect(controlWorkflow(f.env, f.ledger, "owned", "pause")).rejects.toThrow("Cannot pause");
  expect(f.counts().pauses + f.counts().resumes).toBe(0);
});
test("only exact agent initiators or owners control runs; write access alone cannot pause integration", () => {
  const own: OwnedWorkflow = { kind: "agent", instanceId: "run", actorId: "User_A" };
  expect(() => assertWorkflowControlPermission(own, "User_A", false)).not.toThrow();
  expect(() => assertWorkflowControlPermission(own, "user_a", false)).toThrow("Only the run");
  expect(() => assertWorkflowControlPermission({ ...own, kind: "integration" }, "User_A", false)).toThrow("Only the run");
  expect(() => assertWorkflowControlPermission({ ...own, kind: "integration", actorId: null }, "Owner", true)).not.toThrow();
});
test("registered but missing provider run returns recoverable unavailable status", async () => {
  const f = fixture("running");
  f.env.AGENT_WORKFLOW = { get: async () => { throw new Error("Instance does not exist"); } } as unknown as Workflow;
  await expect(controlWorkflow(f.env, f.ledger, "owned", "status")).rejects.toMatchObject({ statusCode: 404 });
});
test("provider lookup failure suppresses raw error and refuses a new transition", async () => {
  const f = fixture("running");
  f.env.AGENT_WORKFLOW = { get: async () => { throw new Error("sensitive provider error credential-value-123456"); } } as unknown as Workflow;
  await expect(controlWorkflow(f.env, f.ledger, "owned", "pause")).rejects.toMatchObject({ statusCode: 503, message: "Workflow status is temporarily unavailable; retry without starting a new run" });
  expect(f.counts().pauses).toBe(0);
});
