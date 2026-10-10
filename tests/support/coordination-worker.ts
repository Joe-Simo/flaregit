import { RepositoryController } from "../../src/server/durable-object";
import { proveRecordedContradiction } from "../../src/server/requirement-decisions";
import { dispatchDecisionRevisions } from "../../src/server/coordination-dispatch";
import type { CoordinationRuntime } from "../../src/server/coordination-runtime";
import { claimDueRevisions, PostLandRebaseLedger, type RebaseExecution } from "../../src/server/post-land-rebase";
import { retryDueRebaseRevisions, sendRebaseRevision } from "../../src/server/revision-dispatch";
import { coordinationHttp } from "../../src/server/coordination-http";
import { runRequirementGate } from "../../src/server/requirement-gate-runner";
import type { LandingOutcome } from "../../src/server/merge-queue-runner";
import { ACT3 } from "../../src/scenarios/ticket-booking";
import type { Env } from "../../src/server/env";
import type { Ledger } from "../../src/server/durable-object";
import type { Requirement, Task } from "../../src/core/types";

const PROJECT_ID = "p123456789abc";
const HEAD = "a".repeat(40);
const actor = (userId: string) => ({ userId, displayName: userId === "owner" ? "Owner" : "Member", viaToken: false });

export class CoordinationFixture extends RepositoryController {
  private clockOffsetMs = 0;
  /** Same claim as production, read at the fixture's clock so backoff can be exercised. */
  override async claimDueRebaseRevisions() {
    const state = await this.getState();
    return this.ctx.storage.transactionSync(() => claimDueRevisions(new PostLandRebaseLedger(this.ctx.storage), state, new Date(Date.now() + this.clockOffsetMs)));
  }
  private write(mutate: (state: Awaited<ReturnType<RepositoryController["getState"]>>) => void) {
    return this.getState().then((state) => { mutate(state); this.ctx.storage.sql.exec("UPDATE project SET doc=? WHERE id=1", JSON.stringify(state)); return state; });
  }
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body = async <T>() => (await request.json()) as T;
    try {
      switch (url.pathname) {
        case "/seed":
          await this.initialize({ projectId: PROJECT_ID, projectName: "Coordination fixture", canonicalRepoName: "canonical", head: HEAD, verificationPolicy: {}, ownerId: "owner" });
          await this.addMember("member", "member");
          return Response.json({ seeded: true });
        case "/task": {
          const input = await body<{ id: string; commit: string; base?: string; agent?: boolean; act3?: 0 | 1; dependsOn?: string; requirementId?: string }>();
          const requirements: Requirement[] = input.act3 === undefined ? [] : structuredClone(ACT3[input.act3].requirements).map((requirement) => (input.requirementId ? { ...requirement, id: input.requirementId } : requirement));
          await this.write((state) => {
            const stamp = new Date().toISOString();
            const task: Task = { id: input.id, goal: `Change ${input.id}`, contributor: input.agent ? { id: `agent-${input.id}`, name: "FlareGit agent", type: "agent" } : { id: "owner", name: "Owner", type: "human" }, baseCommit: input.base ?? state.acceptedState.currentCommit, currentCommit: input.commit, status: "ready", allowedScope: ["src/"], requirements, workspace: { repoName: `ws-${input.id}`, remote: "https://fixture.invalid", branch: `task/${input.id}` }, checkpoints: [], createdAt: stamp, updatedAt: stamp, ...(input.dependsOn ? { dependsOn: input.dependsOn } : {}) };
            state.tasks[input.id] = task;
          });
          return Response.json({ created: true });
        }
        case "/landing": {
          const input = await body<{ tasks: string[]; holder: string }>();
          return Response.json(await this.claimLanding({ holder: input.holder, taskIds: input.tasks, preservationProtocolVersion: 1 }));
        }
        case "/land": {
          // Stands in for compose/verify/review/push of the integration workflow; publication uses the real ledger.
          const input = await body<{ eventId: string; newHead: string }>();
          const journalId = crypto.randomUUID();
          await this.write((state) => {
            const candidate = Object.values(state.candidates).find((value) => value.workflowInstanceId === input.eventId);
            if (!candidate) throw new Error("No candidate for this landing");
            candidate.candidateCommit = input.newHead;
            candidate.status = "verified";
            state.journal.push({ id: journalId, candidateId: candidate.id, candidateCommit: input.newHead, candidateTree: "c".repeat(40), expectedHead: state.acceptedState.currentCommit, newHead: input.newHead, outputDigest: "fixture-output", state: "PREPARED", timestamp: new Date().toISOString(), ...(candidate.frozenAttribution ? { contributionAttribution: candidate.frozenAttribution } : {}) });
          });
          await this.completePublish(journalId);
          return Response.json({ accepted: (await this.getState()).acceptedState.currentCommit });
        }
        case "/enqueue": {
          const input = await body<{ requestId: string; taskIds: string[]; actor?: string }>();
          return Response.json(await this.mergeQueueEnqueue({ requestId: input.requestId, taskIds: input.taskIds }, actor(input.actor ?? "owner"), undefined, Date.now() + 60_000));
        }
        case "/advance": return Response.json(await this.mergeQueueAdvance());
        case "/settle": {
          const input = await body<{ eventId: string; outcome: LandingOutcome; reason?: string }>();
          return Response.json(await this.mergeQueueSettle(input.eventId, input.outcome, input.reason));
        }
        case "/view": return Response.json(await this.coordinationView(url.searchParams.get("actor") ?? "owner"));
        case "/resolve": {
          const input = await body<{ decisionId: string; optionId: string; actor: string }>();
          return Response.json(await this.resolveDecision(input.decisionId, input.optionId, actor(input.actor), undefined, Date.now() + 60_000));
        }
        case "/plan-rebase": {
          const input = await body<{ landed: string; workflowId: string }>();
          return Response.json(await this.postLandRebasePlan(input.landed, input.workflowId));
        }
        case "/record-rebase": return Response.json(await this.recordPostLandRebase(await body<{ taskId: string; landedCommit: string; fromCommit: string; execution: RebaseExecution }>()));
        case "/clock": {
          // Moves the fixture's view of "now" forward so a backoff can elapse without waiting.
          this.clockOffsetMs = (await body<{ advanceMs: number }>()).advanceMs;
          return Response.json({ offset: this.clockOffsetMs });
        }
        case "/alarm-at": return Response.json({ alarm: await this.ctx.storage.getAlarm() });
        case "/comments": return Response.json(await this.listComments(`change:${url.searchParams.get("task")}`));
        case "/set-candidate-commit": {
          const input = await body<{ holder: string; commit: string }>();
          await this.write((state) => {
            const candidate = Object.values(state.candidates).find((value) => value.workflowInstanceId === input.holder);
            if (!candidate) throw new Error("No candidate for this landing");
            candidate.candidateCommit = input.commit;
            candidate.status = "verified";
          });
          return Response.json({ updated: true });
        }
        case "/abort": {
          // The workflow's response to a blocked candidate: it fails and the landing lease is released.
          const input = await body<{ holder: string; reason: string }>();
          const candidate = Object.values((await this.getState()).candidates).find((value) => value.workflowInstanceId === input.holder);
          if (!candidate) throw new Error("No candidate for this landing");
          await this.abortPublish(candidate.id, undefined, input.reason, "failed");
          return Response.json({ aborted: true });
        }
        case "/review": {
          const input = await body<{ holder: string; approved: boolean }>();
          const candidate = Object.values((await this.getState()).candidates).find((value) => value.workflowInstanceId === input.holder);
          if (!candidate?.candidateCommit) throw new Error("No candidate for this landing");
          return Response.json(await this.recordReview(candidate.id, { approved: input.approved, actor: actor("owner") }, candidate.candidateCommit));
        }
        case "/state": return Response.json(await this.getState());
        default: return new Response("Missing fixture route", { status: 404 });
      }
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Fixture failure" }, { status: 409 });
    }
  }
}

/** Pricing implementations at each fixture commit; the runtime double executes them for the probe. */
type Quote = (input: { ticketCount: number; basePrice: number; isRefundable?: boolean }) => { total: number };
const IMPLEMENTATIONS: Record<string, Quote> = {
  ["b".repeat(40)]: ({ ticketCount, basePrice, isRefundable }) => { const fee = isRefundable ? 5 * ticketCount : 0; return { total: (ticketCount * basePrice + fee) * (ticketCount >= 4 ? 0.85 : 1) }; },
  ["c".repeat(40)]: ({ ticketCount, basePrice, isRefundable }) => { const fee = isRefundable ? 5 * ticketCount : 0; return { total: ticketCount * basePrice * (ticketCount >= 4 ? 0.85 : 1) + fee }; },
};

/** Container double: Git steps succeed and the probe step runs the implementation recorded for the commit. */
function runtimeDouble(commands: string[]): CoordinationRuntime {
  return {
    platformDir: "/opt/flaregit",
    workDir: "/workspace",
    shell: async () => ({
      exec: async (command) => {
        commands.push(command);
        const probe = /probe-cli\.ts '([^']+)' '([a-f0-9]{40})' '([^']+)'$/.exec(command);
        if (!probe) return { success: true, stdout: "", stderr: "" };
        const implementation = IMPLEMENTATIONS[probe[2]!];
        const request = JSON.parse(probe[3]!) as { input: Parameters<Quote>[0] };
        return { success: true, stdout: JSON.stringify(implementation ? { ok: true, output: implementation(request.input) } : { ok: false, error: "No code at this commit" }), stderr: "" };
      },
      close: async () => {},
    }),
    credential: async (repoName) => ({ remote: `https://${"0".repeat(32)}.artifacts.cloudflare.net/${repoName}`, token: "fixture-token", close: async () => {} }),
  };
}

const created = new Map<string, unknown>();
const agentWorkflowDouble = {
  get: async (id: string) => { if (!created.has(id)) throw new Error("instance.not_found"); return { id, status: async () => ({ status: "running" }) }; },
  create: async ({ id, params }: { id: string; params: unknown }) => { if (created.has(id)) throw new Error("instance.already_exists"); created.set(id, params); return { id }; },
};

/** Managed spending at its platform limit ("none") or with room again ("ok"); the real spend ledger decides. */
const envWith = (env: Env, capacity: string | null) => ({ ...env, AGENT_WORKFLOW: agentWorkflowDouble, ...(capacity === "none" ? { MANAGED_GLOBAL_MONTHLY_USD_MICROS: "2000000" } : {}) }) as unknown as Env;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const name = url.searchParams.get("name") ?? "coordination";
    const stub = env.REPOSITORY_CONTROLLER.getByName(name) as unknown as Ledger & { fetch(request: Request): Promise<Response> };
    const capacity = url.searchParams.get("capacity");
    try {
      if (url.pathname === "/revise-post-land") {
        const input = (await request.json()) as { taskId: string; landedCommit: string; workflowId: string };
        const sent = await sendRebaseRevision(envWith(env, capacity), stub, PROJECT_ID, { ...input, actorId: "owner" });
        return Response.json({ ...sent, created: [...created.keys()] });
      }
      if (url.pathname === "/retry-due") {
        const records = await retryDueRebaseRevisions(envWith(env, capacity), stub, PROJECT_ID);
        return Response.json({ records, created: [...created.keys()] });
      }
      if (url.pathname === "/run-agent-again") {
        // The production route, with the fixture standing in for session authentication.
        const actorId = url.searchParams.get("actor") ?? "owner";
        const response = await coordinationHttp({ sub: "/changes/run-agent-again", method: "POST", request, env: envWith(env, capacity), ctx, project: stub, projectId: PROJECT_ID, userId: actorId, displayName: async () => actorId, freshActor: async () => ({ identity: { expiresAt: Date.now() + 60_000 }, isOwner: actorId === "owner" || url.searchParams.has("forge") }) });
        const bodyText = await response!.text();
        return Response.json({ status: response!.status, body: bodyText, created: [...created.keys()] });
      }
      if (url.pathname === "/prove") {
        const { decisionId } = (await request.json()) as { decisionId: string };
        const commands: string[] = [];
        const result = await proveRecordedContradiction(runtimeDouble(commands), stub, decisionId);
        return Response.json({ result, probes: commands.filter((command) => command.includes("probe-cli.ts")).length });
      }
      if (url.pathname === "/gate") {
        // Stands in for the compose step of the integration workflow, then runs the production requirement gate.
        const { holder, commit } = (await request.json()) as { holder: string; commit: string };
        await stub.fetch(new Request(`http://test/set-candidate-commit?name=${name}`, { method: "POST", body: JSON.stringify({ holder, commit }) }));
        const state = await stub.getState();
        const candidate = Object.values(state.candidates).find((value) => value.workflowInstanceId === holder)!;
        const examples = await stub.requirementGatePlan(candidate.id);
        const commands: string[] = [];
        const shell = await runtimeDouble(commands).shell("requirement-gate");
        const checks = await runRequirementGate((command) => shell.exec(command), { platformDir: "/opt/flaregit", repoDir: "/workspace/candidate", commit, examples });
        const failure = await stub.recordRequirementChecks(candidate.id, commit, checks);
        return Response.json({ failure, checks, probes: commands.length });
      }
      if (url.pathname === "/dispatch-revisions") {
        const { decisionId } = (await request.json()) as { decisionId: string };
        const results = await dispatchDecisionRevisions({ ...env, AGENT_WORKFLOW: agentWorkflowDouble } as unknown as Env, stub, PROJECT_ID, decisionId, "owner");
        return Response.json({ results, created: [...created.entries()] });
      }
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Fixture failure" }, { status: 409 });
    }
    return stub.fetch(request);
  },
};
