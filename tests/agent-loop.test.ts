import { expect, test } from "bun:test";
import { agentLoopRounds, executeAgentRound, explainAgentRun, fundedAgentRounds, interpretCheckRun, repositoryCheckScript, runAgentLoop, summarizeTestRun, type AgentChecks, type AgentRoundStep, type RoundDependencies } from "../src/server/agent-loop";
import { assertAgentWrites } from "../src/agents/prompt";
import { managedAgentEnvelope } from "../src/server/projects";

// Deterministic model and check doubles: these prove loop control, not hosted execution.
const source = { "src/math.ts": "export const add = (a: number, b: number) => a - b;\n" };
const fix = `<plan>\n- Fix add\n</plan>\n<edit path="src/math.ts">\n<search>\na - b\n</search>\n<replace>\na + b\n</replace>\n</edit>\n<reasoning>Subtraction was used.</reasoning>`;
const deps = (answer: string, checks: AgentChecks, snapshot: Record<string, string> = source): RoundDependencies => ({
  task: { goal: "Fix add", requirements: [], allowedScope: ["src/"] }, agentName: "Agent", snapshot,
  model: async () => answer, assertWrites: (paths) => assertAgentWrites({ allowedScope: ["src/"] }, paths, ["tests/"]), runChecks: async () => checks,
});

test("round configuration defaults to 3 and enforces the hard maximum of 5", () => {
  expect(agentLoopRounds(undefined)).toBe(3);
  expect(agentLoopRounds("5")).toBe(5);
  expect(() => agentLoopRounds("6")).toThrow(/1 to 5/);
  expect(() => agentLoopRounds("two")).toThrow();
  expect(fundedAgentRounds(5, managedAgentEnvelope("a", "b"), 300)).toBe(5);
  expect(fundedAgentRounds(5, { maxCalls: 8, maxContainerSeconds: 1200 }, 300)).toBe(3);
});

test("a passing round is final and records counts", async () => {
  const outcome = await executeAgentRound({ round: 1, maxRounds: 3, history: [], files: {} }, deps(fix, { kind: "ran", report: summarizeTestRun(0, " 4 pass\n 0 fail\n") }));
  expect(outcome.final).toBe(true);
  expect(outcome.files["src/math.ts"]).toContain("a + b");
  expect(outcome.record).toMatchObject({ edits: "applied", filesChanged: ["src/math.ts"], plan: ["Fix add"], tests: { status: "passed", passed: 4, failed: 0 } });
});

test("failing tests continue the loop until the last round; stale edits become feedback", async () => {
  const failing = { kind: "ran" as const, report: summarizeTestRun(1, " 3 pass\n 1 fail\nerror: expect(received).toBe(expected)\n") };
  const first = await executeAgentRound({ round: 1, maxRounds: 2, history: [], files: {} }, deps(fix, failing));
  expect(first.final).toBe(false);
  expect(first.record.tests).toMatchObject({ status: "failed", passed: 3, failed: 1 });
  const second = await executeAgentRound({ round: 2, maxRounds: 2, history: [first.record], files: first.files }, deps(fix, failing, { ...source, ...first.files }));
  expect(second.final).toBe(true);
  expect(second.record.edits).toBe("rejected");
  expect(second.files).toEqual(first.files);
});

test("policy refusals throw instead of becoming feedback", async () => {
  const protectedEdit = `<create path="tests/x.test.ts">\nx\n</create>`;
  await expect(executeAgentRound({ round: 1, maxRounds: 3, history: [], files: {} }, deps(protectedEdit, { kind: "ran", report: summarizeTestRun(0, "") }))).rejects.toThrow(/outside the task scope|protected/);
});

test("repositories without runnable tests stop after one round and say so", async () => {
  const outcome = await executeAgentRound({ round: 1, maxRounds: 3, history: [], files: {} }, deps(fix, { kind: "unavailable", reason: "No test command." }));
  expect(outcome.final).toBe(true);
  expect(outcome.verification).toBe("standard-verification");
  expect(explainAgentRun("Fix add", 3, [outcome.record], outcome.verification).note).toMatch(/no tests the agent could run/);
});

test("loop stops at the bound and feeds each round's history forward", async () => {
  const seen: number[] = [];
  const result = await runAgentLoop({ maxRounds: 9, step: (_name, run) => run(), runRound: async (input): Promise<AgentRoundStep> => {
    seen.push(input.history.length);
    return { kind: "round", record: { round: input.round, plan: [], reasoning: "", filesChanged: ["src/a.ts"], edits: "applied", tests: { status: "failed", passed: 0, failed: 1, summary: "x" } }, files: { "src/a.ts": `${input.round}` }, final: false, verification: "repository-tests" };
  } });
  expect(result.rounds).toBe(5);
  expect(seen).toEqual([0, 1, 2, 3, 4]);
});

test("run ledger stores a redacted explanation that only grows", async () => {
  const { Database } = await import("bun:sqlite");
  const { AgentRunLedger } = await import("../src/server/agent-run-ledger");
  const db = new Database(":memory:");
  const storage = { sql: { exec(query: string, ...bindings: Array<string | number>) { const statements = query.split(";").map((part) => part.trim()).filter(Boolean); let rows: unknown[] = []; for (const statement of statements) rows = db.query(statement).all(...(statements.length === 1 ? bindings : [])); return { toArray: () => rows }; } }, transactionSync<T>(callback: () => T): T { return db.transaction(callback)(); } } as unknown as DurableObjectStorage;
  const ledger = new AgentRunLedger(storage);
  ledger.claim({ runId: "run1", taskId: "task1", startingCommit: "a".repeat(40), startingBranchHead: null, branch: "task/one", goal: "Fix add", context: { comments: [] }, allowedScope: ["src/"], protectedPaths: [] });
  const round = (n: number) => ({ round: n, plan: ["Fix"], reasoning: "token ghp_abcdefghijklmnopqrstuvwxyz0123", filesChanged: ["src/a.ts"], edits: "applied" as const, tests: { status: "failed" as const, passed: 1, failed: 1, summary: "x" } });
  expect(ledger.explain("run1", "task1", explainAgentRun("Fix add", 3, [round(1), round(2)], "repository-tests"))).toBe(true);
  expect(ledger.explain("run1", "task1", explainAgentRun("Fix add", 3, [round(1)], "repository-tests"))).toBe(true);
  const saved = ledger.get("run1")!.explanation!;
  expect(saved.rounds).toHaveLength(2);
  expect(JSON.stringify(saved)).not.toContain("ghp_");
  expect(ledger.explain("other", "task1", explainAgentRun("Fix add", 3, [round(1)], "repository-tests"))).toBe(false);
});

test("check script isolates identity and environment; exit codes map honestly", () => {
  const script = repositoryCheckScript({ workspace: "/workspace/task", install: "bun install", test: "bun test", timeoutSeconds: 999, runId: "run1" });
  expect(script).toContain("setpriv --reuid");
  expect(script).toContain("--no-new-privs");
  expect(script).toContain("env -i");
  expect(script).toContain("--exclude=./.git");
  expect(script).toContain("timeout -s KILL 150");
  expect(interpretCheckRun(97, "").kind).toBe("unavailable");
  expect(interpretCheckRun(98, "network down").kind).toBe("unavailable");
  const timedOut = interpretCheckRun(137, "");
  expect(timedOut.kind === "ran" && timedOut.report.summary).toMatch(/time limit/);
  expect(summarizeTestRun(1, "Tests: 2 failed, 10 passed, 12 total").passed).toBe(10);
  expect(summarizeTestRun(1, "token ghp_abcdefghijklmnopqrstuvwxyz0123 failed").summary).not.toContain("ghp_");
});

test("a search block that does not match feeds the exact current file into the next round, and the next edit applies", async () => {
  const landed = { "src/pricing.ts": "export const fee = 5;\nexport function feeFor(amount: number) { return amount * fee / 100; }\n" };
  const stale = `<plan>\n- Add refundable fee\n</plan>\n<edit path="src/pricing.ts">\n<search>\nexport const fee = 7;\n</search>\n<replace>\nexport const fee = 7;\nexport const refundable = true;\n</replace>\n</edit>`;
  const failing = { kind: "ran" as const, report: summarizeTestRun(1, " 1 fail\n") };
  const first = await executeAgentRound({ round: 1, maxRounds: 3, history: [], files: {} }, deps(stale, failing, landed));
  expect(first.record.edits).toBe("rejected");
  expect(first.record.mismatch).toEqual({ path: "src/pricing.ts", whole: true, current: landed["src/pricing.ts"] });
  const prompts: string[] = [];
  // Deterministic double: copies its search block from the excerpt the feedback showed.
  const recover = (prompt: string) => {
    const excerpt = /<current-excerpt path="src\/pricing.ts">\n([\s\S]*?)\n<\/current-excerpt>/.exec(prompt)![1]!;
    const line = excerpt.split("\n").find((value) => value.includes("feeFor"))!;
    return `<plan>\n- Add refundable fee\n</plan>\n<edit path="src/pricing.ts">\n<search>\n${line}\n</search>\n<replace>\n${line}\nexport const refundableFee = (amount: number) => feeFor(amount);\n</replace>\n</edit>`;
  };
  const second = await executeAgentRound({ round: 2, maxRounds: 3, history: [first.record], files: first.files }, { ...deps("", { kind: "ran", report: summarizeTestRun(0, " 1 pass\n") }, landed), model: async (prompt) => { prompts.push(prompt); return recover(prompt); } });
  expect(prompts[0]).toContain("The whole current content of src/pricing.ts is exactly");
  expect(second.record.edits).toBe("applied");
  expect(second.files["src/pricing.ts"]).toContain("refundableFee");
});

test("a large file's mismatch feedback is the bounded region around the closest match", async () => {
  const filler = Array.from({ length: 400 }, (_, index) => `export const value${index} = ${index};`).join("\n");
  const big = { "src/big.ts": `${filler}\nexport function target(amount: number) { return amount; }\n${filler.replaceAll("value", "other")}\n` };
  const stale = `<plan>\n- Change target\n</plan>\n<edit path="src/big.ts">\n<search>\nexport function target(amount: number) { return amount * 2; }\n</search>\n<replace>\nx\n</replace>\n</edit>`;
  const outcome = await executeAgentRound({ round: 1, maxRounds: 2, history: [], files: {} }, deps(stale, { kind: "unavailable", reason: "none" }, big));
  const mismatch = outcome.record.mismatch!;
  expect(mismatch.whole).toBe(false);
  expect(mismatch.current.length).toBeLessThanOrEqual(4000);
  expect(mismatch.current).toContain("export function target(amount: number) { return amount; }");
  expect(big["src/big.ts"]).toContain(mismatch.current);
});
