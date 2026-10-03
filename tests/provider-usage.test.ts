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
  expect(sanitizeUsage("worker:flaregit", data("workersInvocationsAdaptive", Array.from({length:100},()=>({sum:{requests:1,errors:0,subrequests:0}}))), from, until).status).toBe("incomplete");
  expect(sanitizeUsage("worker:flaregit", data("workersInvocationsAdaptive", [{sum:{requests:-1,errors:0,subrequests:0}}]), from, until).status).toBe("unavailable");
  expect(()=>sanitizeUsage("worker:other-project", {}, from, until)).toThrow();
});
test("collector makes only four scoped queries, hashes receipts, rejects unbounded windows and classifies response limits", async () => {
  const queries: string[] = [];
  const fetcher: UsageFetcher = async (_input, init) => {
    queries.push(String(init?.body));
    return new Response(JSON.stringify({errors:[{message:"Unknown field provider secret"}]}), {headers:{"content-type":"application/json"}});
  };
  const receipt = await collectProviderUsage({token:"opaque",start:from,end:until,fetcher});
  expect(queries).toHaveLength(4); expect(queries.every(query=>query.includes("9888fed381861dcc35a37b026ff176e9"))).toBeTrue();
  expect(receipt.receiptHash).toMatch(/^[a-f0-9]{64}$/); expect(receipt.invoice).toBe("unverified"); expect(receipt.completeness).toBe("incomplete");
  expect(JSON.stringify(receipt)).not.toContain("secret");
  await expect(collectProviderUsage({token:"opaque",start:from,end:"2026-10-04T00:00:00Z",fetcher})).rejects.toThrow();
  const limited: UsageFetcher = async ()=>new Response("{}",{headers:{"content-length":"2000000"}});
  const oversized = await collectProviderUsage({token:"opaque",start:from,end:until,fetcher:limited});
  expect(oversized.observations.every(row=>row.reason==="response_limit")).toBeTrue();
});

 test("GraphQL nullable error/data envelopes distinguish successful metrics from failed queries", () => {
  const success = {...data("workersInvocationsAdaptive", [{sum:{requests:4,errors:0,subrequests:9}}]), errors:null};
  expect(sanitizeUsage("worker:flaregit", success, from, until).units).toEqual({requests:4,errors:0,subrequests:9});
  const denied = {data:null,errors:[{message:"not authorized private provider context"}]};
  expect(sanitizeUsage("worker:flaregit", denied, from, until).reason).toBe("access_denied");
  expect(sanitizeUsage("worker:flaregit", {data:null,errors:null}, from, until).status).toBe("unavailable");
  expect(sanitizeUsage("worker:flaregit", {data:{viewer:null},errors:null}, from, until).status).toBe("unavailable");
 });
