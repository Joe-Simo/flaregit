import {expect, test} from "bun:test";
import {agentMayCall} from "../src/core/agent-permissions";

const grant = {repository: "org/app", tools: ["read_file", "run_tests"]};

test("agents are limited to granted tools and their repository", () => {
  expect(agentMayCall(grant, "read_file", "org/app")).toBe(true);
  expect(agentMayCall(grant, "push", "org/app")).toBe(false);
  expect(agentMayCall(grant, "read_file", "org/other")).toBe(false);
});
