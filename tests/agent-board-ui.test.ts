import { expect, test } from "bun:test";
import { agentBoardStatus, overlapSentence } from "../src/web/components/AgentBoard";

const progress = (step: number, round = 1) => ({ step, steps: 4 as const, round });

test("agent rows describe what the agent is doing in plain words", () => {
  expect(agentBoardStatus({ phase: "planning", taskStatus: "working", progress: progress(1) })).toBe("Planning");
  expect(agentBoardStatus({ phase: "proposed", taskStatus: "working", progress: progress(2) })).toBe("Editing");
  expect(agentBoardStatus({ phase: "pushed", taskStatus: "working", progress: progress(3) })).toBe("Running tests (attempt 1)");
  expect(agentBoardStatus({ phase: "proposed", taskStatus: "working", progress: progress(2, 2) })).toBe("Editing (attempt 2)");
  expect(agentBoardStatus({ phase: "checkpointed", taskStatus: "ready", progress: progress(4) })).toBe("Ready");
  expect(agentBoardStatus({ phase: "pushed", taskStatus: "blocked", progress: progress(3) })).toBe("Blocked");
});

test("overlap warnings lead with the shared file and the other goal, never ids", () => {
  const sentence = overlapSentence({ kind: "divergent_content", path: "src/pricing.ts" }, "Guarantee the advertised price");
  expect(sentence).toBe("Also editing src/pricing.ts: “Guarantee the advertised price” — edits may conflict.");
  expect(sentence).not.toMatch(/change |--[0-9a-f]{6}/);
});
