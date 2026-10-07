import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";

test("native workerd private agent egress keeps credentials server-side and cleans exact request receipts", async () => {
  if (await workerdChild("tests/agent-egress-worker.test.ts")) return;
  const file = `/tmp/flaregit-agent-egress-worker-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, "build", "tests/support/agent-egress-worker-fixture.ts", "--target=browser", "--external=cloudflare:workers", `--outfile=${file}`], { stdout: "ignore", stderr: "pipe" });
  const [stderr, exit] = await Promise.all([new Response(build.stderr).text(), build.exited]); if (exit) throw new Error(stderr);
  const script = await Bun.file(file).text(); await Bun.file(file).delete();
  const remoteOrigin = `https://${"a".repeat(32)}.artifacts.cloudflare.net`;
  const serviceProps = { attemptId: "11111111-1111-4111-8111-111111111111", nativeId: "22222222-2222-4222-8222-222222222222", scope: { projectId: "p123456789abc", incarnation: "33333333-3333-4333-8333-333333333333", actorId: "actor", accountKey: "account", taskId: "task", runId: "run", workflowId: "workflow", branchGeneration: 1, canonicalRepoName: "canonical", forkRepoName: "fork", remote: `${remoteOrigin}/fork.git`, branch: "task/one", expectedTip: "a".repeat(40), access: "read" } };
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "private-agent-egress", modules: true, script, compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], durableObjects: { REPOSITORY_CONTROLLER: { className: "AgentEgressLedgerFixture", useSQLite: true } }, serviceBindings: { PRIVATE_EGRESS: { name: "private-agent-egress", entrypoint: "AgentEgressWorker", props: serviceProps } }, outboundService: { name: "synthetic-agent-upstream" } }, { name: "synthetic-agent-upstream", modules: true, script: `export default { fetch(request) { if(request.url!=="${remoteOrigin}/fork.git/info/refs?service=git-upload-pack"||request.headers.get("Authorization")!=="Bearer server-secret")return new Response("Synthetic upstream refused",{status:403});return new Response("Private service Git bytes"); } };`, compatibilityDate: "2026-10-02" }] }));
  type Result = { recordedPush?:{oldCommit:string|null;newCommit:string;ref:string};retainedBackground:number;foregroundCleanupCalls:number;status:number;body:string;headers:Record<string,string>;calls:string[];sameRequestId:boolean;upstream:Array<{authorization:string|null;url:string}> };
  const read = async (mode: string) => (await (await mf.getWorker("private-agent-egress")).fetch(`http://fixture/?mode=${mode}`)).json() as Promise<Result>;
  try {
    const privateResponse = await (await mf.getWorker("private-agent-egress")).fetch("http://fixture/entrypoint");
    expect(privateResponse.status).toBe(200); expect(await privateResponse.text()).toBe("Private service Git bytes");
    const success = await read("ok"); expect(success.status).toBe(200); expect(success.body).toBe("Git protocol bytes"); expect(success.upstream[0]?.authorization).toBe("Bearer server-secret"); expect(success.headers.authorization).toBeUndefined(); expect(success.headers["set-cookie"]).toBeUndefined(); expect(success.sameRequestId).toBe(true); expect(success.calls.indexOf("cleanup")).toBeGreaterThan(success.calls.indexOf("upstream"));
    for (const mode of ["transport", "lost-issuance", "cleanup-fails"]) { const failure = await read(mode); expect(failure.status).toBe(503); expect(failure.calls).toContain("cleanup"); expect(failure.body).not.toContain("server-secret"); expect(failure.body).not.toContain("Git protocol bytes"); expect(failure.sameRequestId).toBe(true); }
    const own=await read("own-push");expect(own.status).toBe(200);expect(own.body).toBe("Git protocol bytes");expect(own.recordedPush).toEqual({oldCommit:"a".repeat(40),newCommit:"b".repeat(40),ref:"refs/heads/task/one"});expect(own.calls.indexOf("own-push-recorded")).toBeLessThan(own.calls.indexOf("upstream"));expect(own.sameRequestId).toBe(true);
    const race=await read("own-push-race");expect(race.status).toBe(503);expect(race.body).not.toContain("Git protocol bytes");expect(race.calls).toContain("cleanup");
    expect(success.retainedBackground).toBe(1);
    const late=await read("late-issuance");expect(late.status).toBe(503);expect(late.retainedBackground).toBe(1);expect(late.foregroundCleanupCalls).toBe(1);expect(late.calls.filter(call=>call==="cleanup").length).toBe(2);expect(late.calls.filter(call=>call==="issued").length).toBe(1);expect(late.body).not.toContain("server-secret");expect(late.upstream).toEqual([]);
    for (const mode of ["denied", "budget", "revoked"]) { const failure = await read(mode); expect(failure.status).toBe(mode === "denied" ? 403 : 503); expect(failure.upstream).toEqual([]); expect(failure.calls).not.toContain("issued"); expect(failure.calls).not.toContain("cleanup"); }
  } finally { await mf.dispose(); }
}, 30000);
