import { nativeFunding } from "./support/native-funding.js";
import { accountKeyFor } from "../src/server/projects.js";
import { expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env } from "../src/server/env.js";
import type { CandidateGeneration } from "../src/core/types.js";
import type { Ledger } from "../src/server/durable-object.js";

mock.module("cloudflare:workers", () => ({
  WorkflowEntrypoint: class { constructor(_ctx: unknown, public env: Env) {} },
  DurableObject: class {},
}));
const { FlareGitIntegrationWorkflow } = await import("../src/server/workflow.js");

test("publication releases its ephemeral checkout while preserving the reviewed immutable Git ref", async () => {
  const root = await mkdtemp(join(tmpdir(), "workflow-lifecycle-"));
  const canonical = join(root, "canonical.git"), seed = join(root, "seed"), workspace = join(root, "publish");
  const git = async (args: string[]) => {
    const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@localhost", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@localhost" } });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exitCode) throw new Error(stderr);
    return stdout.trim();
  };
  try {
    await git(["init", "--bare", "--initial-branch=main", canonical]);
    await git(["clone", canonical, seed]);
    await Bun.write(join(seed, "feature.txt"), "base");
    await git(["-C", seed, "add", "."]); await git(["-C", seed, "commit", "-m", "base"]);
    await git(["-C", seed, "push", "origin", "main"]);
    const base = await git(["-C", seed, "rev-parse", "HEAD"]);
    await Bun.write(join(seed, "feature.txt"), "reviewed feature");
    await git(["-C", seed, "commit", "-am", "candidate"]);
    const commit = await git(["-C", seed, "rev-parse", "HEAD"]);
    await git(["-C", seed, "push", "origin", `${commit}:refs/flaregit/candidates/test`]);
    let destroyed = 0;
    const env = {
    ...nativeFunding(),
      ...nativeFunding(),
      ARTIFACTS: { get: async () => ({ info: async () => ({ remote: canonical }), createToken: async () => ({ plaintext: "fixture-token" }) }) },
      INTEGRATOR: { getByName: () => ({
        exec: async (argv: string[]) => {
          const command = argv[2]!.replaceAll("/workspace/publish", workspace);
          const child = Bun.spawn(["sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
          const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
          return { success: exitCode === 0, stdout, stderr, exitCode };
        },
        destroy: async () => { destroyed++; await rm(workspace, { recursive: true, force: true }); },
      }) },
    } as unknown as Env;
    const workflow = new FlareGitIntegrationWorkflow({} as ExecutionContext, env);
    Object.assign(workflow,{projectId:"repo",computeAccountKey:await accountKeyFor("fixture-human"),computeWorkflowId:"registered-parent"});
    const callable = workflow as unknown as { casPush(candidate: CandidateGeneration, commit: string, stub: Ledger, branch: string): Promise<{ ok: boolean }> };
    const result = await callable.casPush({ id: "test", expectedAcceptedBase: base } as CandidateGeneration, commit, { getState: async () => ({ canonicalRepoName: "repo" }) } as unknown as Ledger, "main");
    expect(result.ok).toBe(true);
    expect(destroyed).toBe(1);
    expect(await Bun.file(join(workspace, ".git", "HEAD")).exists()).toBe(false);
    expect(await git(["--git-dir", canonical, "rev-parse", "refs/flaregit/candidates/test"])).toBe(commit);
    expect(await git(["--git-dir", canonical, "rev-parse", "main"])).toBe(commit);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operation error survives failed shutdown and cleanup failure becomes durable activity", async () => {
  const activities: string[] = [];
  let destroyCalls = 0;
  const original = new Error("Original fetch failure");
  const funding=nativeFunding();
  const env = {
    ...nativeFunding(),
    ARTIFACTS: { get: async () => ({ info: async () => ({ remote: "https://repo.example" }), createToken: async () => ({ plaintext: "fixture-token" }) }) },
    INTEGRATOR: { getByName: () => ({ exec: async () => { throw original; }, destroy: async () => { destroyCalls++; throw new Error("Shutdown failed"); } }) },
    REPOSITORY_CONTROLLER: { idFromName: (name: string) => name, get: (name: string) => name === "global" ? funding.REPOSITORY_CONTROLLER.get(funding.REPOSITORY_CONTROLLER.idFromName("global")) : ({ accountLifecycle:async()=>"active",getWorkflowRun:async()=>({actorId:"fixture-human"}),roleOf:async()=>"owner",logActivity: async (_actor: string, kind: string) => { activities.push(kind); } }) },
  } as unknown as Env;
  const workflow = new FlareGitIntegrationWorkflow({} as ExecutionContext, env);
    Object.assign(workflow,{projectId:"repo",computeAccountKey:await accountKeyFor("fixture-human"),computeWorkflowId:"registered-parent"});
  const callable = workflow as unknown as { casPush(candidate: CandidateGeneration, commit: string, stub: Ledger, branch: string): Promise<unknown> };
  await expect(callable.casPush({ id: "test", expectedAcceptedBase: "a".repeat(40) } as CandidateGeneration, "b".repeat(40), { getState: async () => ({ canonicalRepoName: "repo" }) } as unknown as Ledger, "main")).rejects.toBe(original);
  expect(destroyCalls).toBe(1);
  expect(activities).toEqual(["container.cleanup_failed"]);
});

test("external-only workflow composes native Git and stores immutable candidate without customer commands or AI", async () => {
  const root = await mkdtemp(join(tmpdir(), "external-workflow-"));
  const canonical = join(root, "canonical.git"), seed = join(root, "seed"), work = join(root, "integration");
  const git = async (args: string[]) => {
    const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@localhost", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@localhost" } });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exitCode) throw new Error(stderr); return stdout.trim();
  };
  try {
    await git(["init", "--bare", "--initial-branch=main", canonical]); await git(["clone", canonical, seed]);
    await Bun.write(join(seed, "feature.ts"), "throw new Error('Customer code must never execute');");
    await git(["-C", seed, "add", "."]); await git(["-C", seed, "commit", "-m", "base"]); await git(["-C", seed, "push", "origin", "main"]);
    const base = await git(["-C", seed, "rev-parse", "HEAD"]);
    await git(["-C", seed, "checkout", "-b", "task/one"]); await Bun.write(join(seed, "feature.ts"), "throw new Error('Functional source still must never execute');");
    await git(["-C", seed, "commit", "-am", "feature"]); await git(["-C", seed, "push", "origin", "task/one"]);
    const head = await git(["-C", seed, "rev-parse", "HEAD"]);
    let destroyed = 0, aiCalls = 0;
    const commands: string[] = [], stored: string[] = [];
    const env = {
    ...nativeFunding(),
      ...nativeFunding(),
      ARTIFACTS: { get: async () => ({ info: async () => ({ remote: canonical }), createToken: async () => ({ plaintext: "fixture-token" }) }) },
      EVIDENCE_BUCKET: { put: async (key: string) => { stored.push(key); } }, AI: { run: async () => { aiCalls++; throw new Error("AI must not run"); } },
      INTEGRATOR: { getByName: () => ({ exec: async (argv: string[]) => {
        const original = argv[2]!; commands.push(original);
        const command = original.replaceAll("/workspace/integration", work).replaceAll("/opt/flaregit", process.cwd());
        const child = Bun.spawn(["sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        return { success: exitCode === 0, stdout, stderr, exitCode };
      }, destroy: async () => { destroyed++; await rm(work, { recursive: true, force: true }); } }) },
    } as unknown as Env;
    const task = { id: "one", baseCommit: base, currentCommit: head, allowedScope: ["feature.ts"], workspace: { repoName: "repo", branch: "task/one" }, contributor: { name: "Fixture", id: "one" } };
    const candidate: CandidateGeneration = { id: "external-one", attemptNumber: 1, frozenRequirements: [], repairAttempts: [], status: "composing", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expectedAcceptedBase: base, participatingTaskIds: ["one"], participatingCommits: { one: head }, frozenPolicyVersion: 1, frozenVerificationPolicy: { kind: "command", test: "touch CUSTOMER_COMMAND_EXECUTED", install: "touch CUSTOMER_INSTALL_EXECUTED", allowedScope: ["feature.ts"], protectedPaths: ["tests/"] }, frozenExternalChecksPolicy: { version: 1, mode: "external", checks: [{ id: "check", providerId: "provider", required: true }] }, frozenContributorProofs: [{ id: "one", commit: head, baseCommit: base, ref: "refs/flaregit/tasks/one", allowedScope: ["feature.ts"] }] };
    const evidence: import("../src/core/types.js").VerificationEvidence[] = [];
    const ledger = { getState: async () => ({ canonicalRepoName: "repo", tasks: { one: task }, defaultBranch: "main" }), recordComposition: async () => {}, recordVerification: async (_id: string, _commit: string, proof: import("../src/core/types.js").VerificationEvidence) => { evidence.push(proof); } } as unknown as Ledger;
    const workflow = new FlareGitIntegrationWorkflow({} as ExecutionContext, env);
    Object.assign(workflow,{projectId:"repo",computeAccountKey:await accountKeyFor("fixture-human"),computeWorkflowId:"registered-parent"});
    const callable = workflow as unknown as { composeRepairVerify(candidate: CandidateGeneration, params: { projectId: string; taskIds: string[] }, ledger: Ledger): Promise<{ ok: boolean; commit?: string }> };
    const result = await callable.composeRepairVerify(candidate, { projectId: "repo", taskIds: ["one"] }, ledger);
    expect(result.ok).toBe(true); expect(destroyed).toBe(1); expect(aiCalls).toBe(0);
    expect(evidence[0]?.verifierIdentity).toBe("flaregit-native-integrity-v1");
    expect(stored).toHaveLength(1); expect(stored[0]).toMatch(/^evidence\//);
    expect(commands.some((command) => command.includes("--native-integrity"))).toBe(true);
    expect(commands.some((command) => command.includes("build-preview") || command.includes("verification/cli.ts custom "))).toBe(false);
    expect(await git(["--git-dir", canonical, "rev-parse", "refs/flaregit/candidates/external-one"])).toBe(result.commit!);
    expect(await git(["--git-dir", canonical, "rev-parse", "main"])).toBe(base);
  } finally { await rm(root, { recursive: true, force: true }); }
});
