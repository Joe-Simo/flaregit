import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
import { AGENT_BOARD_ACCESS_CLOSED, agentBoardEventSchema, type AgentBoardEvent, type OverlapWarning } from "../src/core/agent-board";
import type { AgentRunInput } from "../src/server/agent-run-ledger";
import type { Task } from "../src/core/types";

const task = (id: string, goal: string): Task => ({
  id, goal, contributor: { id: "agent", name: "Agent", type: "agent" }, baseCommit: "a".repeat(40), allowedScope: ["src/"], status: "working", requirements: [],
  workspace: { repoName: `t-${id}`, remote: "https://artifacts.invalid/repo.git", branch: `task/${id}` } as Task["workspace"], checkpoints: [], currentCommit: "a".repeat(40),
  createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z",
});
const run = (runId: string, taskId: string, goal: string): AgentRunInput => ({ runId, taskId, startingCommit: "a".repeat(40), startingBranchHead: null, branch: `task/${taskId}`, goal, context: { comments: [] }, allowedScope: ["src/"], protectedPaths: [] });

test("agent board: refused upgrades, live snapshot and events, overlap warnings, shared context, and access withdrawal", async () => {
  if (await workerdChild("tests/agent-board.test.ts")) return;
  const bundle = `/tmp/flaregit-agent-board-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, "build", "tests/support/agent-board-worker.ts", "--target=browser", "--external=cloudflare:workers", "--external=node:*", `--outfile=${bundle}`], { stdout: "ignore", stderr: "pipe" });
  const [error, code] = await Promise.all([new Response(build.stderr).text(), build.exited]); if (code !== 0) throw new Error(error);
  const script = await Bun.file(bundle).text(); await Bun.file(bundle).delete();
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "agent-board", modules: true, script, compatibilityDate: "2026-10-02", durableObjects: { TEST: { className: "AgentBoardFixture", useSQLite: true } } }] }));
  const origin = (await mf.ready).toString().replace(/\/$/, "");
  const post = async (route: string, body: unknown) => fetch(`${origin}${route}`, { method: "POST", body: JSON.stringify(body) });
  const upgrade = async (ticket?: string) => fetch(`${origin}/agent-board${ticket ? `?ticket=${ticket}` : ""}`, { headers: { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13" } });
  const ticketFor = async (userId: string) => (await (await post("/ticket", { userId })).json() as { ticket: string }).ticket;
  try {
    // Upgrade refused without access.
    expect((await upgrade()).status).toBe(401);
    expect((await upgrade("x".repeat(43))).status).toBe(401);
    expect((await post("/ticket", { userId: "mallory" })).status).toBe(409);
    await post("/member", { userId: "bob" });
    const bobTicket = await ticketFor("bob");
    await post("/remove-member", { userId: "bob" });
    expect((await upgrade(bobTicket)).status).toBe(403);
    await post("/member", { userId: "alice" });
    const aliceTicket = await ticketFor("alice");
    // Snapshot then live incremental events over a real WebSocket handshake.
    const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/agent-board?ticket=${aliceTicket}`); const events: AgentBoardEvent[] = []; let closed = null as number | null, opened = false;
    ws.addEventListener("open", () => { opened = true; });
    ws.addEventListener("message", event => events.push(agentBoardEventSchema.parse(JSON.parse(String(event.data)))));
    ws.addEventListener("close", event => { closed = event.code; });
    const until = async (predicate: () => boolean) => { for (let i = 0; i < 300 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10)); expect(predicate()).toBe(true); };
    await until(() => opened && events.length >= 1);
    expect((await upgrade(aliceTicket)).status).toBe(401);
    expect(events[0]).toEqual({ type: "snapshot", seq: 0, agents: [], overlaps: [] });

    await post("/task", { task: task("pricing-a", "Raise prices") });
    await post("/task", { task: task("pricing-b", "Add discounts") });
    expect((await (await post("/claim", run("run-a", "pricing-a", "Raise prices"))).json() as { kind: string }).kind).toBe("claimed");
    await until(() => events.some(event => event.type === "agent.updated" && event.agent.runId === "run-a"));
    const started = events.find(event => event.type === "agent.updated" && event.agent.runId === "run-a");
    expect(started?.type === "agent.updated" && started.agent).toMatchObject({ taskId: "pricing-a", title: "Raise prices", phase: "planning", commit: "a".repeat(40), progress: { round: 1, step: 1, steps: 4 }, filesTouched: [] });

    await post("/claim", run("run-b", "pricing-b", "Add discounts"));
    expect(await (await post("/propose", { runId: "run-a", taskId: "pricing-a", files: { "src/pricing.ts": "export const price = 2;\n", "src/a.ts": "a\n" } })).json() as boolean).toBe(true);
    expect(await (await post("/propose", { runId: "run-b", taskId: "pricing-b", files: { "src/pricing.ts": "export const discount = 1;\n" } })).json() as boolean).toBe(true);

    // Overlap warning created, persisted and broadcast.
    await until(() => events.some(event => event.type === "overlap.added"));
    const added = events.find(event => event.type === "overlap.added");
    expect(added?.type === "overlap.added" && added.overlap).toMatchObject({ path: "src/pricing.ts", kind: "divergent_content", a: { taskId: "pricing-a", runId: "run-a" }, b: { taskId: "pricing-b", runId: "run-b" } });
    const persisted = await (await post("/warnings", { taskId: "pricing-b" })).json() as OverlapWarning[];
    expect(persisted.map(warning => [warning.path, warning.kind])).toEqual([["src/pricing.ts", "divergent_content"]]);
    await until(() => events.some(event => event.type === "agent.updated" && event.agent.runId === "run-b" && event.agent.overlapIds.length === 1 && event.agent.phase === "proposed"));
    const sequence = events.map(event => event.seq);
    expect(sequence).toEqual(sequence.map((_, index) => index === 0 ? 0 : index));

    // Shared context injected for each affected agent.
    const contextB = await (await post("/context", { runId: "run-b", taskId: "pricing-b" })).json() as string[];
    expect(contextB[0]).toBe('Overlap warning: agent for change pricing-a ("Raise prices") is also editing src/pricing.ts with different content; a Git merge conflict on this file is likely, so keep your edits to it minimal and compatible.');
    expect(contextB.join("\n")).toContain('Concurrent agent for change pricing-a ("Raise prices") is editing: src/a.ts, src/pricing.ts.');
    const contextA = await (await post("/context", { runId: "run-a", taskId: "pricing-a" })).json() as string[];
    expect(contextA[0]).toContain('agent for change pricing-b ("Add discounts") is also editing src/pricing.ts');

    // Resync returns a sequence-consistent snapshot.
    const before = events.length;
    ws.send(JSON.stringify({ type: "resync" }));
    await until(() => events.length > before);
    const resync = events.at(-1)!;
    expect(resync.type === "snapshot" && resync.agents.map(agent => agent.runId)).toEqual(["run-a", "run-b"]);
    expect(resync.type === "snapshot" && resync.overlaps.length).toBe(1);
    expect(resync.seq).toBe(events.at(-2)!.seq);

    // Membership withdrawal closes the socket.
    await post("/remove-member", { userId: "alice" });
    await until(() => closed !== null);
    expect(closed).toBe(AGENT_BOARD_ACCESS_CLOSED);
  } finally { await mf.dispose(); }
}, 30000);
