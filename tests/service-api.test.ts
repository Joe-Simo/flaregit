import { workerdChild } from "./support/workerd-child";
import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { signServiceRead } from "../src/server/service-read-auth";
import { signIntegrationCallback } from "../src/server/integration-auth";

test("production Worker service routes verify signatures before user login and enforce repository, replay and body boundaries", async () => {
  if (await workerdChild("tests/service-api.test.ts")) return;
  const built = await Bun.build({ entrypoints: ["tests/support/service-api-worker.ts"], target: "browser", external: ["cloudflare:workers", "node:*"] });
  if (!built.success) throw new Error(built.logs.join("\n"));
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "service-api-test", modules: true, script: await built.outputs[0]!.text(), compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], durableObjects: { TEST: { className: "ServiceApiFixture", useSQLite: true } } }] }));
  const request = async (path: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => (await mf.getWorker("service-api-test")).fetch(`http://test${path}`, init);
  try {
    const humanHeaders={Authorization:`Bearer fgt_abcdef123456_${"x".repeat(32)}`};
    for(const endpoint of ["/api/projects","/api/p/abcdef123456/tasks/task-one/agent"]){
      for(const body of ["{invalid","[]","null","x".repeat(131073)])expect((await request(endpoint,{method:"POST",headers:humanHeaders,body})).status).toBe(400);
    }
    expect((await(await request("/expensive-count")).json() as {count:number}).count).toBe(0);
    const created = await (await request("/setup")).json() as { metadata: { id: string }; secret: string };
    const prefix = `/api/p/abcdef123456/connections/${created.metadata.id}`;
    const path = `${prefix}/candidates/candidate-one?commit=${"a".repeat(40)}`;
    const timestamp = Math.floor(Date.now() / 1000), nonce = "api_nonce_fixture_123456";
    const signature = await signServiceRead(created.secret, { method: "GET", path, timestamp, nonce });
    const headers = { "X-Flaregit-Timestamp": String(timestamp), "X-Flaregit-Nonce": nonce, "X-Flaregit-Signature": signature };
    expect((await request(path)).status).toBe(401);
    expect((await request(path, { headers })).status).toBe(200);
    expect((await request(path, { headers })).status).toBe(404);
    expect((await request(path.replace("abcdef123456", "abcdef123457"), { headers })).status).toBe(401);
    expect((await request(path + "&extra=changed", { headers })).status).toBe(401);
    const body = JSON.stringify({ serviceId: created.metadata.id, repositoryId: "abcdef123456", eventId: "report-event", timestamp, report: { type: "check", candidateId: "candidate-one", commit: "a".repeat(40), tree: "b".repeat(40), checkId: "check-one", runId: "run-one", policyVersion: 2, sequence: 0, status: "passed", summary: "Synthetic API fixture" } });
    const post = { method: "POST", body, headers: { "X-Flaregit-Signature": await signIntegrationCallback(created.secret, body) } };
    expect((await request(`${prefix}/events`, post)).status).toBe(200);
    expect((await (await request(`${prefix}/events`, post)).json() as { kind: string }).kind).toBe("duplicate");
    expect((await request(`${prefix}/events`, { method: "POST", body: "x".repeat(65_537) })).status).toBe(413);
    expect((await request("/api/p/abcdef123456/candidates/candidate-one/review", { method: "POST", body: JSON.stringify({ approved: true }), headers })).status).toBe(503);
    await request("/revoke", { method: "POST", body: JSON.stringify({ id: created.metadata.id }) });
    expect((await request(`${prefix}/events`, post)).status).toBe(401);
  } finally { await mf.dispose(); }
}, 30_000);
