import { describe, expect, test } from "bun:test";
import { assertAgentWrites, buildAgentPrompt, redactSecrets } from "../src/agents/prompt.js";
import { buildRepairPrompt, type RepairOptions } from "../src/core/pipeline/repair.js";
import { freezeCandidateGeneration } from "../src/core/pipeline/freeze.js";
import { signPreview, verifyPreview } from "../src/server/preview-access.js";
import type { Env } from "../src/server/env.js";
import type { CandidateGeneration, Requirement, Task } from "../src/core/types.js";

function task(id: string, name: string, goal: string, scope: string[] = ["src/"]): Task {
  return {
    id, goal, contributor: { id: `u_${id}`, name, type: "human" }, baseCommit: "base0", allowedScope: scope,
    status: "working", requirements: [], workspace: {}, checkpoints: [], currentCommit: `commit_${id}`,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as Task;
}

describe("redactSecrets", () => {
  const cases: [string, string][] = [
    ["pem", "-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY-----"],
    ["aws", "AKIAABCDEFGHIJKLMNOP"],
    ["ghp", "ghp_" + "a".repeat(36)],
    ["github_pat", "github_pat_" + "B".repeat(40)],
    ["slack", "xoxb-1234567890-abcdefghij"],
    ["sk", "sk-" + "Z".repeat(32)],
    ["fgt", "fgt_0123456789ab_" + "x".repeat(40)],
    ["fgg", "fgg_p0123456789ab_" + "a".repeat(64)],
    ["whsec", "whsec_" + "Q".repeat(24)],
    ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlX3ZhbHVl"],
  ];
  for (const [name, secret] of cases) {
    test(`redacts ${name}`, () => {
      const out = redactSecrets(`before ${secret} after`);
      expect(out).not.toContain(secret);
      expect(out).toContain("[REDACTED]");
      expect(out.startsWith("before ")).toBe(true);
    });
  }
  test("assignments keep key name", () => {
    expect(redactSecrets('password = "hunter2hunter2"')).toBe("password = [REDACTED]");
    expect(redactSecrets("api_key: abcdefgh12345")).toBe("api_key: [REDACTED]");
  });
  test("ordinary code unchanged", () => {
    const code = 'export function add(a: number, b: number) {\n  const skip = "sk-short";\n  return a + b;\n}\nconst password = input;';
    expect(redactSecrets(code)).toBe(code);
  });
});

describe("buildAgentPrompt / assertAgentWrites", () => {
  test("includes redacted shared context and scope", () => {
    const t = task("t1", "Ada", "Add totals", ["src/cart.ts", "lib/"]);
    const p = buildAgentPrompt(t, "agent-x", { "src/cart.ts": "const x = 1;" }, "bun test", "note: AKIAABCDEFGHIJKLMNOP");
    expect(p).toContain("Shared context");
    expect(p).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(p).toContain("[REDACTED]");
    expect(p).toContain("You may only change: src/cart.ts, lib/.");
    expect(p).toContain('<current path="src/cart.ts">');
  });
  test("rejects escapes, out-of-scope, protected", () => {
    const t = { allowedScope: ["src/"] };
    expect(() => assertAgentWrites(t, ["src/../etc/passwd"], [])).toThrow(/escapes/);
    expect(() => assertAgentWrites(t, ["/abs"], [])).toThrow(/escapes/);
    expect(() => assertAgentWrites(t, ["lib/a.ts"], [])).toThrow(/outside/);
    expect(() => assertAgentWrites(t, ["src/tests/a.ts"], ["src/tests/"])).toThrow(/protected/);
    expect(() => assertAgentWrites(t, ["src/a.ts"], ["src/tests/"])).not.toThrow();
    for (const file of [".git/config", "src/.git/config", "src/a\u0000.ts", "src/./a.ts", "src//a.ts", "src\\a.ts"]) {
      expect(() => assertAgentWrites({ allowedScope: ["*"] }, [file], [])).toThrow(/escapes/);
    }
  });
  test("redacts task, contributor, requirements and verification instructions", () => {
    const secret = "ghp_" + "a".repeat(36);
    const t = task("t1", "Ada", secret);
    t.requirements = [{ title: secret, description: secret }] as Requirement[];
    const p = buildAgentPrompt(t, secret, {}, secret, secret);
    expect(p).not.toContain(secret);
  });
});

describe("buildRepairPrompt", () => {
  const candidate = { frozenRequirements: [] as Requirement[] } as unknown as CandidateGeneration;
  const opts = (tasks: Task[]): RepairOptions => ({
    repoDir: "", candidate, tasks, round: 1, conflictType: "text_conflict", editableFiles: [], fileContents: {},
    protectedPaths: [], model: async () => "",
  });
  test("single change uses stale-base wording", () => {
    const p = buildRepairPrompt(opts([task("a", "Ada", "goal A")]));
    expect(p).toContain("written against an older version");
    expect(p).toContain("Contributor A (Ada): goal A");
    expect(p).not.toContain("Contributor B");
  });
  test("three changes list A, B, C", () => {
    const p = buildRepairPrompt(opts([task("a", "Ada", "gA"), task("b", "Bob", "gB"), task("c", "Cy", "gC")]));
    expect(p).toContain("3 contributors changed the same codebase in parallel");
    expect(p).toContain("Contributor A (Ada): gA");
    expect(p).toContain("Contributor B (Bob): gB");
    expect(p).toContain("Contributor C (Cy): gC");
  });
  test("redacts repair source, side versions and contributor context", () => {
    const secret = "ghp_" + "a".repeat(36);
    const p = buildRepairPrompt({ ...opts([task("a", "Ada", secret)]), editableFiles: ["src/a.ts"], fileContents: { "src/a.ts": secret }, contextFiles: { "src/b.ts": secret }, sideVersions: { "src/a.ts": { base: secret, a: secret, b: secret } } });
    expect(p).not.toContain(secret);
    expect(p).toContain("[REDACTED]");
  });
});

describe("preview signing", () => {
  const env = { PREVIEW_SIGNING_KEY: "unit-test-signing-key" } as unknown as Env;
  test("round trip and failures", async () => {
    const { exp, sig } = await signPreview(env, "p1", "c1");
    expect(await verifyPreview(env, "p1", "c1", exp, sig)).toBe(true);
    expect(await verifyPreview(env, "p2", "c1", exp, sig)).toBe(false);
    expect(await verifyPreview(env, "p1", "c2", exp, sig)).toBe(false);
    const tampered = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    expect(await verifyPreview(env, "p1", "c1", exp, tampered)).toBe(false);
    expect(await verifyPreview(env, "p1", "c1", exp + 1, sig)).toBe(false);
  });
  test("expired fails", async () => {
    const { exp, sig } = await signPreview(env, "p1", "c1", -10);
    expect(await verifyPreview(env, "p1", "c1", exp, sig)).toBe(false);
  });
  test("missing key throws", async () => {
    expect(signPreview({} as unknown as Env, "p", "c")).rejects.toThrow(/PREVIEW_SIGNING_KEY/);
  });
});

describe("freezeCandidateGeneration", () => {
  const base = { acceptedBaseCommit: "acc0", policyVersion: 3, verificationPolicy: { x: 1 }, approvedRequirements: [] };
  test("one task", () => {
    const c = freezeCandidateGeneration({ ...base, tasks: [task("a", "Ada", "g")] });
    expect(c.participatingTaskIds).toEqual(["a"]);
    expect(c.participatingCommits).toEqual({ a: "commit_a" });
    expect(c.attemptNumber).toBe(1);
  });
  test("three tasks keep order", () => {
    const ts = [task("z", "Z", "g"), task("a", "A", "g"), task("m", "M", "g")];
    const c = freezeCandidateGeneration({ ...base, tasks: ts, attemptNumber: 2 });
    expect(c.participatingTaskIds).toEqual(["z", "a", "m"]);
    expect(c.participatingCommits).toEqual({ z: "commit_z", a: "commit_a", m: "commit_m" });
    expect(c.expectedAcceptedBase).toBe("acc0");
    expect(c.attemptNumber).toBe(2);
  });
});
