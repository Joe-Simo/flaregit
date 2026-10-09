import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
import type { AgentChangeExplanation } from "../src/server/agent-loop";

interface Probe { log: Array<{ kind: string; value: string }>; explanation: AgentChangeExplanation | null }

test("real Workflow checkpoints each agent round, feeds failures forward and stays bounded", async () => {
  if (await workerdChild("tests/agent-loop-workflow.test.ts")) return;
  const path = `/tmp/flaregit-agent-loop-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, "build", "tests/support/agent-loop-workflow-worker.ts", "--target=browser", "--external=cloudflare:workers", "--external=node:*", `--outfile=${path}`], { stdout: "ignore", stderr: "pipe" });
  if (await build.exited !== 0) throw Error(await new Response(build.stderr).text());
  const script = await Bun.file(path).text(); await Bun.file(path).delete();
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "loop", modules: true, script, compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], durableObjects: { PROBE: { className: "Probe", useSQLite: true } }, workflows: { LOOP: { name: "agent-loop", className: "AgentLoopFixture" } } }] }));
  const call = async (route: string) => (await mf.getWorker("loop")).fetch(`http://fixture${route}`);
  const settle = async (id: string) => { for (let n = 0; n < 300; n++) { const status = await (await call(`/status?id=${id}`)).json() as { status: string; output?: unknown; error?: unknown }; if (["complete", "errored"].includes(status.status)) return status; await new Promise((resolve) => setTimeout(resolve, 50)); } throw Error("Workflow did not settle"); };
  try {
    // Never passes: interrupted in round 2, must stop at the 3-round bound.
    await call("/start?id=failing&max=3&pass=99&interrupt=2");
    const failing = await settle("failing");
    expect(failing.status).toBe("complete");
    expect(failing.output).toMatchObject({ commit: "", rounds: 3 });
    const probe = await (await call("/probe?id=failing")).json() as Probe;
    const starts = (round: number) => probe.log.filter((entry) => entry.kind === `round-${round}`).length;
    // Round 1 completed before the interruption and was never repeated; only round 2 re-ran.
    expect([starts(1), starts(2), starts(3), starts(4)]).toEqual([1, 2, 1, 0]);
    const prompts = probe.log.filter((entry) => entry.kind === "prompt").map((entry) => entry.value);
    expect(prompts).toHaveLength(4);
    expect(prompts[0]).not.toContain("Results of your earlier rounds");
    expect(prompts.at(-1)).toContain("expected 4 received 0 in round 2");
    expect(prompts.at(-1)).toContain("Round 1: checks failed (1 passed, 1 failed)");
    // The re-run of round 2 sees round 1's applied edit, not the original file.
    expect(prompts[2]).toContain("export const VERSION = 1;");
    expect(probe.explanation).toMatchObject({ verification: "repository-tests", filesTouched: ["src/math.ts"], maxRounds: 3, plan: ["Attempt 3"] });
    expect(probe.explanation?.rounds.map((round) => round.tests.status)).toEqual(["failed", "failed", "failed"]);
    expect(probe.explanation?.note).toMatch(/still failing after 3 of 3 rounds/);

    // Passing on round 2 ends the loop early; an over-large bound is clamped to 5.
    await call("/start?id=passing&max=40&pass=2&interrupt=0");
    const passing = await settle("passing");
    expect(passing.output).toMatchObject({ rounds: 2 });
    const passed = await (await call("/probe?id=passing")).json() as Probe;
    expect(passed.explanation?.rounds.at(-1)?.tests).toMatchObject({ status: "passed", passed: 2, failed: 0 });

    await call("/start?id=bounded&max=40&pass=99&interrupt=0");
    expect((await settle("bounded")).output).toMatchObject({ rounds: 5 });
  } finally { await mf.dispose(); }
}, 60_000);
