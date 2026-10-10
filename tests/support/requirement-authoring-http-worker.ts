import worker from "../../src/server/worker";
import { RepositoryController } from "../../src/server/durable-object";
import type { Ledger } from "../../src/server/durable-object";
import { PrivateRecoveryOperations } from "../../src/server/private-recovery";
import { AcceptedBranchRoots } from "../../src/server/accepted-branch-roots";
import { accountKeyFor } from "../../src/server/projects";
import { proveRecordedContradiction } from "../../src/server/requirement-decisions";
import type { CoordinationRuntime } from "../../src/server/coordination-runtime";
import type { Env } from "../../src/server/env";

const projectId = "p123456789abc", actor = "contributor", base = "a".repeat(40);
const names = new Set<string>(["canonical"]);

const remote = `https://${"a".repeat(32)}.artifacts.cloudflare.net/repo.git`;
export class RequirementAuthoringFixture extends RepositoryController {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, { ...env, ARTIFACTS: { get: async (name: string) => ({ info: async () => this.providerInfo(name), revokeToken: async () => true, [Symbol.dispose]() {} }) } } as unknown as Env);
  }
  async providerInfo(name: string) { return (await this.ctx.storage.get<{ id: string; name: string; description: string | null; remote: string }>(`provider:${name}`)) ?? { id: `fixture-${name}`, name, description: null, remote }; }
  async providerCreated(name: string, description: string) { await this.ctx.storage.put(`provider:${name}`, { id: `fixture-${name}`, name, description, remote }); }
  async seed() {
    await this.initialize({ projectId, projectName: "Requirement authoring", canonicalRepoName: "canonical", head: base, defaultBranch: "main", ownerId: "owner", verificationPolicy: {} });
    await this.addMember(actor, "member");
    const incarnation = new PrivateRecoveryOperations(this.ctx.storage).incarnation();
    new AcceptedBranchRoots(this.ctx.storage).initializePrimary({ projectId, incarnation, canonicalRepoName: "canonical", ref: "refs/heads/main" }, { commit: base, requirements: [] }, () => {});
  }
  async snapshot() {
    return { tasks: (await this.getState()).tasks, decisions: (await this.getState()).decisions, intents: (this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='task_creation_intents'").toArray().length ? this.ctx.storage.sql.exec<{ doc: string }>("SELECT doc FROM task_creation_intents").toArray() : []).map((row) => JSON.parse(row.doc) as { taskId: string; input: unknown }) };
  }
  /** Stands in for pushes and Mark ready: each change's branch now holds the given commit. */
  async markReady(changes: Array<{ id: string; commit: string }>) {
    const state = await this.getState();
    for (const change of changes) { const task = state.tasks[change.id]!; task.currentCommit = change.commit; task.status = "ready"; }
    this.ctx.storage.sql.exec("UPDATE project SET doc=? WHERE id=1", JSON.stringify(state));
  }
  async combine(taskIds: string[]) {
    return this.claimLanding({ holder: `combine-${taskIds.join("-")}`, taskIds, preservationProtocolVersion: 1 });
  }
}

/** calculateQuote at each pushed commit; the container double runs the one recorded for the probed commit. */
type Quote = (input: { ticketCount: number; basePrice: number }) => { total: number };
const IMPLEMENTATIONS: Record<string, Quote> = {
  ["b".repeat(40)]: ({ ticketCount, basePrice }) => ({ total: ticketCount * basePrice * (ticketCount >= 4 ? 0.85 : 1) }),
  ["c".repeat(40)]: ({ ticketCount, basePrice }) => ({ total: ticketCount * basePrice }),
};
function runtimeDouble(commands: string[]): CoordinationRuntime {
  return {
    platformDir: "/opt/flaregit",
    workDir: "/workspace",
    shell: async () => ({
      exec: async (command) => {
        commands.push(command);
        const probe = /probe-cli\.ts '([^']+)' '([a-f0-9]{40})' '([^']+)'$/.exec(command);
        if (!probe) return { success: true, stdout: "", stderr: "" };
        const request = JSON.parse(probe[3]!) as { probe: { module: string; export: string }; input: Parameters<Quote>[0] };
        const implementation = request.probe.module === "src/pricing.ts" && request.probe.export === "calculateQuote" ? IMPLEMENTATIONS[probe[2]!] : undefined;
        return { success: true, stdout: JSON.stringify(implementation ? { ok: true, output: implementation(request.input) } : { ok: false, error: "No such function at this commit" }), stderr: "" };
      },
      close: async () => {},
    }),
    credential: async (repoName) => ({ remote: `https://${"0".repeat(32)}.artifacts.cloudflare.net/${repoName}`, token: "fixture-token", close: async () => {} }),
  };
}

export default {
  async fetch(request: Request, env: Env & { FIXTURE_ISSUER: string }, ctx: ExecutionContext) {
    const url = new URL(request.url), repo = env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`) as unknown as RequirementAuthoringFixture & Ledger;
    try {
      if (url.pathname === "/fixture/seed") {
        await repo.seed();
        const account = env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor(actor)}`) as unknown as RequirementAuthoringFixture;
        await account.setProfile({ handle: actor, displayName: "Contributor", bio: "", joinedAt: "now" });
        return Response.json({ actor });
      }
      if (url.pathname === "/fixture/snapshot") return Response.json(await repo.snapshot());
      if (url.pathname === "/fixture/ready") { await repo.markReady(await request.json() as Array<{ id: string; commit: string }>); return Response.json({ ok: true }); }
      if (url.pathname === "/fixture/combine") return Response.json(await repo.combine(await request.json() as string[]));
      if (url.pathname === "/fixture/prove") {
        const { decisionId } = await request.json() as { decisionId: string };
        const commands: string[] = [];
        const result = await proveRecordedContradiction(runtimeDouble(commands), repo, decisionId);
        return Response.json({ result, probes: commands.filter((command) => command.includes("probe-cli.ts")).length });
      }
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Fixture failure" }, { status: 409 });
    }
    const artifacts = {
      list: async () => ({ repos: [...names].map((name) => ({ name })) }),
      get: async (name: string) => ({
        info: async () => repo.providerInfo(name),
        fork: async (repoName: string, options: { description?: string }) => { if (names.has(repoName)) throw Error("Already exists"); names.add(repoName); await repo.providerCreated(repoName, options.description ?? ""); return { id: `fixture-${repoName}`, name: repoName, description: options.description ?? null, remote, token: "synthetic-fork-token" }; },
        readCommit: async (hash: string) => ({ hash }),
        revokeToken: async () => true,
        [Symbol.dispose]() {},
      }),
    };
    return worker.fetch(request, { ...env, ARTIFACTS: artifacts, ARTIFACT_STORAGE_NAMESPACE: "fixture", ARTIFACT_STORAGE_GLOBAL_SLOTS: "32", ARTIFACT_STORAGE_ACCOUNT_SLOTS: "10", API_LIMITER: { limit: async () => ({ success: true }) }, LOOKUP_LIMITER: { limit: async () => ({ success: true }) }, CLERK_ISSUER: env.FIXTURE_ISSUER, CLERK_AUTHORIZED_PARTIES: "https://fixture.example" } as unknown as Env, ctx);
  },
};
