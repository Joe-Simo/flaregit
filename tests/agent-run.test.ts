import { expect, test } from "bun:test";
import { runAgentTask } from "../src/server/agent-run.js";
import type { Task } from "../src/core/types.js";
import type { Ledger } from "../src/server/durable-object.js";
import type { Env } from "../src/server/env.js";

// Unit doubles exercise orchestration boundaries; they are not live agent or Git evidence.
const task: Task = {
  id: "change1", goal: "Change source", contributor: { id: "agent1", name: "Agent", type: "agent" },
  baseCommit: "a".repeat(40), currentCommit: "a".repeat(40), status: "working", allowedScope: ["src/"],
  requirements: [], checkpoints: [], workspace: { repoName: "repo", remote: "https://git.example/repo", branch: "work" },
  createdAt: "2026-10-02", updatedAt: "2026-10-02",
};
function fixture(options: { checkoutFails?: boolean; symlink?: string; secret?: boolean; terminal?: Task["status"]; checkpointApplied?: boolean } = {}) {
  const names: string[] = [], writes: string[] = [], commands: string[] = [];
  let revoked = 0, destroyed = 0, checkpoints = 0;
  const sb = {
    exec: async (argv: string[]) => {
      const cmd = argv[2]!; commands.push(cmd);
      const success = cmd.includes("checkout") ? !options.checkoutFails : cmd.startsWith("test -L") ? Boolean(options.symlink && cmd.includes(options.symlink)) : true;
      return { success, stdout: cmd.includes("ls-files") ? "src/app.ts\0" : cmd.includes("rev-parse HEAD") ? "b".repeat(40) : "", stderr: "" };
    },
    readFile: async () => options.secret ? 'const api_key = "privatecredentialvalue";' : "export const x = 1;",
    writeFile: async (path: string) => { writes.push(path); },
    destroy: async () => { destroyed++; },
  };
  const env = {
    AGENT: { getByName: (name: string) => { names.push(name); return sb; } },
    ARTIFACTS: { get: async () => ({ info: async () => ({ remote: "https://git.example/repo" }), createToken: async () => ({ plaintext: "credential" }), revokeToken: async () => { revoked++; } }) },
    AI: { run: async () => ({ response: '<file path="src/app.ts">\nexport const x = 2;\n</file>' }) },
  } as unknown as Env;
  const ledger = {
    getState: async () => ({ projectId: "project1", tasks: { [task.id]: { ...task, status: options.terminal ?? task.status } } }),
    listComments: async () => [],
    ingestCheckpoint: async () => { checkpoints++; return { applied: options.checkpointApplied ?? true }; },
  } as unknown as Ledger;
  return { env, ledger, names, writes, commands, counts: () => ({ revoked, destroyed, checkpoints }) };
}

test("duplicate agent starts receive distinct sandbox identities", async () => {
  const f = fixture();
  await Promise.all([runAgentTask(f.env, f.ledger, task), runAgentTask(f.env, f.ledger, task)]);
  expect(new Set(f.names).size).toBe(2);
  expect(f.counts()).toEqual({ revoked: 2, destroyed: 2, checkpoints: 2 });
});

test.each(["/src/app.ts", "/src'"])("model writes cannot traverse symlink %s", async (symlink) => {
  const f = fixture({ symlink });
  await expect(runAgentTask(f.env, f.ledger, task)).rejects.toThrow(/symlink/);
  expect(f.writes).toHaveLength(0);
  expect(f.commands.some((cmd) => cmd.includes(" push "))).toBe(false);
});

test("checkout failure stops model writes and push and revokes credentials", async () => {
  const f = fixture({ checkoutFails: true });
  await expect(runAgentTask(f.env, f.ledger, task)).rejects.toThrow(/restore its branch/);
  expect(f.writes).toHaveLength(0);
  expect(f.commands.some((cmd) => cmd.includes(" push "))).toBe(false);
  expect(f.counts()).toEqual({ revoked: 1, destroyed: 1, checkpoints: 0 });
});

test("credential-bearing source cannot be overwritten by model output", async () => {
  const f = fixture({ secret: true });
  await expect(runAgentTask(f.env, f.ledger, task)).rejects.toThrow(/credential-bearing/);
  expect(f.writes).toHaveLength(0);
});


test.each(["cancelled", "accepted"] as const)("%s change cannot push or checkpoint", async (terminal) => {
  const f = fixture({ terminal });
  await expect(runAgentTask(f.env, f.ledger, task)).rejects.toThrow(/stopped|no longer available/);
  expect(f.commands.some((cmd) => cmd.includes(" push "))).toBe(false);
  expect(f.counts().checkpoints).toBe(0);
});

test("refused checkpoint does not report successful completion", async () => {
  const f = fixture({ checkpointApplied: false });
  await expect(runAgentTask(f.env, f.ledger, task)).rejects.toThrow(/checkpoint/);
  expect(f.counts().checkpoints).toBe(1);
});
