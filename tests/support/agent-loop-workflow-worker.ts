import { DurableObject, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { executeAgentRound, explainAgentRun, runAgentLoop, summarizeTestRun, type AgentChangeExplanation } from "../../src/server/agent-loop";
import { assertAgentWrites } from "../../src/agents/prompt";

/** Test-only doubles: a deterministic model and check runner. The loop, prompt,
 * edit validation and Workflow step checkpointing are the real product code. */
interface FixtureEnv { PROBE: DurableObjectNamespace<Probe>; LOOP: Workflow<{ maxRounds: number; passOnRound: number; interruptRound: number }> }
const SOURCE = { "src/math.ts": "export const add = (a: number, b: number) => a - b;\nexport const VERSION = 0;\n" };

export class Probe extends DurableObject {
  async record(kind: string, value: string) { const log = (await this.ctx.storage.get<Array<{ kind: string; value: string }>>("log")) ?? []; log.push({ kind, value }); await this.ctx.storage.put("log", log); return log.filter((entry) => entry.kind === kind).length; }
  async explain(value: AgentChangeExplanation) { await this.ctx.storage.put("explanation", value); }
  async snapshot() { return { log: (await this.ctx.storage.get<Array<{ kind: string; value: string }>>("log")) ?? [], explanation: await this.ctx.storage.get<AgentChangeExplanation>("explanation") ?? null }; }
}

export class AgentLoopFixture extends WorkflowEntrypoint<FixtureEnv, { maxRounds: number; passOnRound: number; interruptRound: number }> {
  override async run(event: WorkflowEvent<{ maxRounds: number; passOnRound: number; interruptRound: number }>, step: WorkflowStep) {
    const probe = this.env.PROBE.getByName(event.instanceId);
    return runAgentLoop({
      maxRounds: event.payload.maxRounds,
      step: (name, run) => step.do(name, { retries: { limit: 1, delay: 10, backoff: "constant" } }, run),
      runRound: async (input) => {
        const attempt = await probe.record(`round-${input.round}`, "started");
        const outcome = await executeAgentRound(input, {
          task: { goal: "Make add correct", requirements: [], allowedScope: ["src/"] }, agentName: "Fixture agent", snapshot: { ...SOURCE, ...input.files },
          model: async (prompt) => {
            await probe.record("prompt", prompt);
            // Each round bumps VERSION, so every round has a real, applicable edit.
            const version = input.round - 1;
            return `<plan>\n- Attempt ${input.round}\n</plan>\n<edit path="src/math.ts">\n<search>\nexport const VERSION = ${version};\n</search>\n<replace>\nexport const VERSION = ${input.round};\n</replace>\n</edit>\n<reasoning>Round ${input.round} reasoning.</reasoning>`;
          },
          assertWrites: (paths) => assertAgentWrites({ allowedScope: ["src/"] }, paths, ["tests/"]),
          runChecks: async () => ({ kind: "ran", report: input.round >= event.payload.passOnRound ? summarizeTestRun(0, " 2 pass\n 0 fail\n") : summarizeTestRun(1, ` 1 pass\n 1 fail\nerror: add(2, 2) expected 4 received 0 in round ${input.round}\n`) }),
        });
        await probe.explain(explainAgentRun("Make add correct", input.maxRounds, [...input.history, outcome.record], outcome.verification));
        // Simulated interruption after the round's work but before its step completes.
        if (input.round === event.payload.interruptRound && attempt === 1) throw new Error("Simulated interruption");
        return outcome;
      },
    });
  }
}

export default {
  async fetch(request: Request, env: FixtureEnv) {
    const url = new URL(request.url), id = url.searchParams.get("id")!;
    if (url.pathname === "/start") { await env.LOOP.create({ id, params: { maxRounds: Number(url.searchParams.get("max")), passOnRound: Number(url.searchParams.get("pass")), interruptRound: Number(url.searchParams.get("interrupt")) } }); return new Response("ok"); }
    if (url.pathname === "/status") return Response.json(await (await env.LOOP.get(id)).status());
    if (url.pathname === "/probe") return Response.json(await env.PROBE.getByName(id).snapshot());
    return new Response("not found", { status: 404 });
  },
};
