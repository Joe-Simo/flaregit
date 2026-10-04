import { expect, test } from "bun:test";
import { collectProviderUsage, sanitizeUsage, type UsageFetcher } from "../src/tooling/provider-usage.js";
const from = "2026-10-02T00:00:00.000Z", until = "2026-10-03T00:00:00.000Z";
const data = (dataset: string, rows: unknown[]) => ({ data: { viewer: { accounts: [{ [dataset]: rows }] } } });
test("provider sanitization strips secrets, PII and event labels and preserves measured units", () => {
  const raw = data("artifactsEventsAdaptiveGroups", [{ count: 3, dimensions: { eventKind: "private name", eventType: "token", secret: "secret" }, token: "secret" }]);
  expect(sanitizeUsage("artifacts:flaregit-default", raw, from, until)).toEqual({ resource: "artifacts:flaregit-default", start: from, end: until, status: "observed", units: { events: 3 } });
  const result = sanitizeUsage("container:a0388b17-59b3-4a6a-98cd-54f1fa766423", data("containersUsageAdaptiveGroups", [{sum:{cpuTimeSec:2,allocatedMemory:6,allocatedDisk:8,txBytes:10}},{sum:{cpuTimeSec:3,allocatedMemory:7,allocatedDisk:9,txBytes:11}}]), from, until);
  expect(result.units).toEqual({cpuTimeSec:5,allocatedMemory:13,allocatedDisk:17,txBytes:21});
});
test("missing data, denied scopes, truncation and malformed quantities never become zero", () => {
  expect(sanitizeUsage("worker:flaregit", data("workersInvocationsAdaptive", []), from, until).status).toBe("zero");
  expect(sanitizeUsage("worker:flaregit", {data:{viewer:{accounts:[]}}}, from, until).status).toBe("unavailable");
  const denied = sanitizeUsage("worker:flaregit", {errors:[{message:"not authorized secret"}]}, from, until);
  expect(denied.reason).toBe("access_denied"); expect(JSON.stringify(denied)).not.toContain("secret");
  expect(sanitizeUsage("worker:flaregit", data("workersInvocationsAdaptive", Array.from({length:100},()=>({sum:{requests:1,errors:0,subrequests:0,cpuTimeUs:0}}))), from, until).status).toBe("incomplete");
  expect(sanitizeUsage("worker:flaregit", data("workersInvocationsAdaptive", [{sum:{requests:-1,errors:0,subrequests:0,cpuTimeUs:0}}]), from, until).status).toBe("unavailable");
  expect(()=>sanitizeUsage("worker:other-project", {}, from, until)).toThrow();
});
test("collector makes only seventeen scoped queries, hashes receipts, rejects unbounded windows and classifies response limits", async () => {
  const queries: string[] = [];
  const fetcher: UsageFetcher = async (_input, init) => {
    queries.push(String(init?.body));
    return new Response(JSON.stringify({errors:[{message:"Unknown field provider secret"}]}), {headers:{"content-type":"application/json"}});
  };
  const receipt = await collectProviderUsage({token:"opaque",start:from,end:until,fetcher});
  expect(queries).toHaveLength(17); expect(queries.every(query=>query.includes("9888fed381861dcc35a37b026ff176e9"))).toBeTrue();
  expect(receipt.receiptHash).toMatch(/^[a-f0-9]{64}$/); expect(receipt.invoice).toBe("unverified"); expect(receipt.completeness).toBe("incomplete");
  expect(JSON.stringify(receipt)).not.toContain("secret");
  await expect(collectProviderUsage({token:"opaque",start:from,end:"2026-10-04T00:00:00Z",fetcher})).rejects.toThrow();
  const limited: UsageFetcher = async ()=>new Response("{}",{headers:{"content-length":"2000000"}});
  const oversized = await collectProviderUsage({token:"opaque",start:from,end:until,fetcher:limited});
  expect(oversized.observations.every(row=>row.reason==="response_limit")).toBeTrue();
});

 test("GraphQL nullable error/data envelopes distinguish successful metrics from failed queries", () => {
  const success = {...data("workersInvocationsAdaptive", [{sum:{requests:4,errors:0,subrequests:9,cpuTimeUs:6}}]), errors:null};
  expect(sanitizeUsage("worker:flaregit", success, from, until).units).toEqual({requests:4,errors:0,subrequests:9,cpuTimeUs:6});
  const denied = {data:null,errors:[{message:"not authorized private provider context"}]};
  expect(sanitizeUsage("worker:flaregit", denied, from, until).reason).toBe("access_denied");
  expect(sanitizeUsage("worker:flaregit", {data:null,errors:null}, from, until).status).toBe("unavailable");
  expect(sanitizeUsage("worker:flaregit", {data:{viewer:null},errors:null}, from, until).status).toBe("unavailable");
 });

 test("new exact-resource metrics preserve CPU units and never equate empty observations with billing", async () => {
  expect(sanitizeUsage("worker:flaregit", data("workersInvocationsAdaptive", [{sum:{requests:1,errors:0,subrequests:0,cpuTimeUs:245}}]), from, until).units?.cpuTimeUs).toBe(245);
  expect(sanitizeUsage("r2:flaregit-evidence", data("r2OperationsAdaptiveGroups", [{sum:{requests:7}}]), from, until).units).toEqual({requests:7});
  expect(sanitizeUsage("workflow:flaregit-integration-workflow", data("workflowsAdaptiveGroups", [{sum:{cpuTime:2,wallTime:3,storageRate:4}}]), from, until).units).toEqual({cpuTime:2,wallTime:3,storageRate:4});
  expect(sanitizeUsage("workflow:flaregit-agent-workflow", data("workflowsAdaptiveGroups", []), from, until).status).toBe("zero");
  expect(()=>sanitizeUsage("workflow:unrelated", {}, from, until)).toThrow();
  const queries:string[]=[];const receipt=await collectProviderUsage({token:"opaque",start:from,end:until,fetcher:async (_url,init)=>{queries.push(String(init.body));return new Response(JSON.stringify({data:null}));}});
  expect(queries.filter(query=>query.includes("workflowName:"))).toHaveLength(6);
  expect(queries.filter(query=>query.includes("bucketName:"))).toHaveLength(1);
  expect(queries.filter(query=>query.includes("workflowsAdaptiveGroups")).every(query=>query.includes("datetimeHour_geq"))).toBeTrue();
  expect(receipt.billingZero).toBe("never_inferred_from_empty_metrics");expect(receipt.units.cpuTime).toBe("CPU_milliseconds");
 });

test("granularity and requested CPU gaps remain explicit and interval ends exclude duplicates", async()=> {
 expect(sanitizeUsage("worker:flaregit",data("workersInvocationsAdaptive",[{sum:{requests:1,errors:0,subrequests:0}}]),from,until).status).toBe("unavailable");
 const queries:string[]=[];const fetcher:UsageFetcher=async(_url,init)=>{queries.push(String(init.body));return new Response(JSON.stringify({data:null}));};
 const receipt=await collectProviderUsage({token:"opaque",start:"2026-10-02T00:15:00Z",end:until,fetcher});
 expect(queries).toHaveLength(11);expect(receipt.observations.filter(row=>row.reason==="unsupported_granularity")).toHaveLength(6);
 expect(receipt.completeness).toBe("incomplete");expect(queries.every(query=>query.includes("datetime_lt:")&&!query.includes("_leq:"))).toBeTrue();
 queries.length=0;await collectProviderUsage({token:"opaque",start:from,end:until,fetcher});
 expect(queries.filter(query=>query.includes("workflowsAdaptiveGroups")).every(query=>query.includes("datetimeHour_lt:")&&!query.includes("_leq:"))).toBeTrue();
});

test("Durable Object namespaces have distinct CPU units and reject missing or malformed quantities",async()=>{
 const resource="do-periodic:7007f9d022ef4d90a4fd7eeef367ebb1";
 const observation=sanitizeUsage(resource,data("durableObjectsPeriodicGroups",[{sum:{cpuTime:12,duration:3,rowsRead:4,rowsWritten:5}}]),from,until);
 expect(observation.units).toEqual({doCpuTimeUs:12,duration:3,rowsRead:4,rowsWritten:5});
 expect(sanitizeUsage(resource,data("durableObjectsPeriodicGroups",[{sum:{cpuTime:12,duration:3,rowsRead:4}}]),from,until).status).toBe("unavailable");
 expect(sanitizeUsage(resource,data("durableObjectsPeriodicGroups",[{sum:{cpuTime:12,duration:3,rowsRead:4.5,rowsWritten:0}}]),from,until).status).toBe("unavailable");
 expect(()=>sanitizeUsage("do-periodic:unrelated",{},from,until)).toThrow();
 const queries:string[]=[];const receipt=await collectProviderUsage({token:"opaque",start:from,end:until,fetcher:async(_url,init)=>{queries.push(String(init.body));return new Response(JSON.stringify({data:null}));}});
 expect(queries.filter(q=>q.includes("namespaceId:"))).toHaveLength(6);
 expect(queries.filter(q=>q.includes("namespaceId:")).every(q=>q.includes("datetime_lt:"))).toBeTrue();
 expect(receipt.units.doCpuTimeUs).toBe("CPU_microseconds");expect(receipt.units.cpuTime).toBe("CPU_milliseconds");expect(receipt.invoice).toBe("unverified");
});
