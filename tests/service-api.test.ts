import { workerdChild } from "./support/workerd-child";
import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { signServiceRead } from "../src/server/service-read-auth";
import { signIntegrationCallback } from "../src/server/integration-auth";

test("production Worker service routes verify signatures before user login and enforce repository, replay and body boundaries", async () => {
  if (await workerdChild("tests/service-api.test.ts")) return;
  const built = await Bun.build({ entrypoints: ["tests/support/service-api-worker.ts"], target: "browser", external: ["cloudflare:workers", "node:*"] });
  if (!built.success) throw new Error(built.logs.join("\n"));
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "service-api-test", unsafeDirectSockets: [{host:"127.0.0.1"}], modules: true, script: await built.outputs[0]!.text(), compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], bindings:{MANAGED_ACCOUNT_MONTHLY_USD_MICROS:"1000000",MANAGED_GLOBAL_MONTHLY_USD_MICROS:"1000000",MANAGED_ESSENTIAL_ACCOUNT_MONTHLY_USD_MICROS:"100000",MANAGED_ESSENTIAL_GLOBAL_MONTHLY_USD_MICROS:"200000"}, durableObjects: { TEST: { className: "ServiceApiFixture", useSQLite: true } } }] }));
  const directUrl = await mf.unsafeGetDirectURL("service-api-test");
  // Auth/body rejection can finish before consuming the request stream. Exercise
  // real HTTP with independent connections rather than Miniflare's object proxy
  // and Bun's reusable transport, which resets after this case on Linux 1.4.2.
  const request = async (path: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => fetch(new URL(path,directUrl), {...init,headers:{Connection:"close","CF-Connecting-IP":"198.51.100.11",...init?.headers}});
  try {
    const pricingPage=await request("/pricing",{headers:{Accept:"text/html"}});
    expect(pricingPage.headers.get("Content-Type")).toContain("text/html");
    await pricingPage.text();
    const legacyPrice=await request("/pricing",{headers:{Accept:"application/json"}});
    expect(await legacyPrice.json<unknown>()).toEqual({status:"unavailable",reason:"not_configured"});
    const publicPrice=await request("/plan-price");
    expect(await publicPrice.json<unknown>()).toEqual({price:{status:"unavailable",reason:"not_configured"},limits:{free:10,pro:200},repositoryLimit:10,sharedRetainedRepositorySlots:null});
    const humanHeaders={Authorization:`Bearer fgt_abcdef123456_${"x".repeat(32)}`};
    for(const endpoint of ["/api/projects","/api/p/abcdef123456/tasks/task-one/agent"]){
      for(const body of ["{invalid","[]","null","x".repeat(131073)])expect((await request(endpoint,{method:"POST",headers:humanHeaders,body})).status).toBe(400);
    }
    expect((await(await request("/expensive-count")).json() as {count:number}).count).toBe(0);
    const publicPath="/api/public/abcdef123456/community";
    expect((await request(publicPath)).status).toBe(404);
    await request("/community-setup");
    expect((await(await mf.getWorker("service-api-test")).fetch(`http://test${publicPath}`)).status).toBe(503);
    const anonymousHeaders={"CF-Connecting-IP":"192.0.2.1"};
    const publicPost={scope:"issues",title:"Public test issue",body:"New public conversation only",idempotencyKey:"public-post-fixture-123"};
    expect((await request(`${publicPath}/posts`,{method:"POST",body:JSON.stringify(publicPost)})).status).toBe(503);
    expect((await request(`${publicPath}/posts`,{method:"POST",headers:humanHeaders,body:JSON.stringify({...publicPost,author:"Spoofed identity"})})).status).toBe(409);
    const savedPublic=await(await request(`${publicPath}/posts`,{method:"POST",headers:humanHeaders,body:JSON.stringify(publicPost)})).json() as {author:string};
    expect(savedPublic.author).toBe("Verified unit actor");
    const anonymousResponse=await request(publicPath,{headers:anonymousHeaders});expect(anonymousResponse.status).toBe(200);
    const anonymous=await anonymousResponse.text();expect(anonymous).not.toContain("fixture-user");expect(anonymous).not.toContain("fixture-account");
    expect((await request(publicPath.replace("abcdef123456","abcdef123457"))).status).toBe(404);
    await request("/community-revoke-during-read");
    const revoked=await request(publicPath,{headers:anonymousHeaders});expect(revoked.status).toBe(409);expect(await revoked.text()).not.toContain(publicPost.body);
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
    const deploymentInput={journalId:"accepted-journal",serviceId:created.metadata.id,environment:"production",idempotencyKey:"deployment-request-fixture"};
    const memberHeaders={Authorization:`Bearer fgt_abcdef123456_${"y".repeat(32)}`};
    expect((await request("/api/p/abcdef123456/deployments",{method:"POST",headers:memberHeaders,body:JSON.stringify(deploymentInput)})).status).toBe(403);
    expect((await request("/api/p/abcdef123456/deployments",{method:"POST",headers:humanHeaders,body:JSON.stringify({...deploymentInput,journalId:"unaccepted"})})).status).toBe(409);
    expect((await request("/api/p/abcdef123456/deployments",{method:"POST",headers:humanHeaders,body:JSON.stringify({...deploymentInput,environment:"x".repeat(101)})})).status).toBe(400);
    expect((await request("/api/p/abcdef123456/deployments",{method:"POST",headers:humanHeaders,body:JSON.stringify({...deploymentInput,pin:{verified:true}})})).status).toBe(400);
    const queuedResponse=await request("/api/p/abcdef123456/deployments",{method:"POST",headers:humanHeaders,body:JSON.stringify(deploymentInput)});if(queuedResponse.status!==201)throw Error(`Deployment fixture HTTP ${queuedResponse.status}: ${await queuedResponse.text()}`);expect(queuedResponse.status).toBe(201);
    const queued=await queuedResponse.json() as{deployment:{id:string;requestEventId:string;target:{acceptedRef:string;commit:string;tree:string}}};
    expect(queued.deployment.target).toMatchObject({acceptedRef:"refs/heads/main",commit:"a".repeat(40),tree:"b".repeat(40)});
    const fundedStats=await(await request("/native-stats")).json() as{vmStarts:number;reservations:number};expect(fundedStats).toEqual({vmStarts:1,reservations:1});
    const repeatedResponse=await request("/api/p/abcdef123456/deployments",{method:"POST",headers:humanHeaders,body:JSON.stringify(deploymentInput)});expect(repeatedResponse.status).toBe(200);
    const repeated=await repeatedResponse.json() as typeof queued;
    expect(repeated.deployment.requestEventId).toBe(queued.deployment.requestEventId);
    expect(await(await request("/native-stats")).json<unknown>()).toEqual(fundedStats);
    await request("/native-budget-deny");
    const deniedCompute=await request("/api/p/abcdef123456/deployments",{method:"POST",headers:humanHeaders,body:JSON.stringify({...deploymentInput,idempotencyKey:"budget-denied-fixture"})});expect(deniedCompute.status).toBe(409);
    expect(await(await request("/native-stats")).json<unknown>()).toEqual(fundedStats);
    await request("/native-budget-restore");
    const restored=await request("/api/p/abcdef123456/deployments",{method:"POST",headers:humanHeaders,body:JSON.stringify({...deploymentInput,idempotencyKey:"budget-denied-fixture"})});expect(restored.status).toBe(201);
    await restored.json<unknown>();
    expect(await(await request("/native-stats")).json<unknown>()).toEqual({vmStarts:2,reservations:2});
    const deploymentBody=JSON.stringify({serviceId:created.metadata.id,repositoryId:"abcdef123456",eventId:"signed-deployment-fixture",timestamp,report:{type:"deployment",deploymentId:queued.deployment.id,commit:"a".repeat(40),tree:"b".repeat(40),sequence:0,status:"succeeded",summary:"Synthetic API deployment receipt, no provider executed"}});
    const deploymentPost={method:"POST",body:deploymentBody,headers:{"X-Flaregit-Signature":await signIntegrationCallback(created.secret,deploymentBody)}};
    expect((await request(`${prefix}/events`,deploymentPost)).status).toBe(200);
    expect((await(await request(`${prefix}/events`,deploymentPost)).json() as{kind:string}).kind).toBe("duplicate");
    const observed=await(await request("/api/p/abcdef123456/deployments",{headers:humanHeaders})).json() as{deployments:Array<{id:string;status:string}>};expect(observed.deployments.find((item)=>item.id===queued.deployment.id)?.status).toBe("succeeded");
    await request("/revoke", { method: "POST", body: JSON.stringify({ id: created.metadata.id }) });
    expect((await request(`${prefix}/events`, post)).status).toBe(401);
  } finally { await mf.dispose(); }
}, 30_000);
