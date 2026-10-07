import { expect, test } from "bun:test";
import { assignedAgentEgress, assignedAgentPushCommand, parseAssignedAgentPushCommand, installAssignedAgentEgress, type AgentExecutionEgressScope, type AgentExecutionEgressCapabilities } from "../src/server/agent-execution-egress";

const remote = `https://${"a".repeat(32)}.artifacts.cloudflare.net/assigned-fork.git`, tip = "b".repeat(40), next = "c".repeat(40);
const scope: AgentExecutionEgressScope = { projectId: "p123456789abc", incarnation: "11111111-1111-4111-8111-111111111111", actorId: "owner", accountKey: "account", taskId: "task-one", runId: "agent-run", workflowId: "workflow", branchGeneration: 2, canonicalRepoName: "canonical-owned", forkRepoName: "assigned-fork", remote, branch: "task/one", expectedTip: tip, access: "write" };
function packet(old = tip, commit = next, ref = "refs/heads/task/one", capabilities = "report-status") {
  const line = new TextEncoder().encode(`${old} ${commit} ${ref}\0${capabilities}\n`);
  return new TextEncoder().encode((line.length + 4).toString(16).padStart(4, "0") + new TextDecoder().decode(line) + "0000PACK");
}
function fixture() {
  const upstream: Request[] = [], calls: string[] = [];
  let current = { ...scope, actorActive: true, accountActive: true, taskActive: true };
  const capabilities: AgentExecutionEgressCapabilities = { current: async () => ({ ...current }), beforeCredential: async (_scope, access) => { calls.push(`credential-budget:${access}`); }, credential: async (_scope, access) => { calls.push(`credential:${access}`); return { repositoryName: scope.forkRepoName, remote, scope: access, token: "server-only-secret", expiresAt: Date.now() + 60000 }; }, beforeTransfer: async () => { calls.push("transfer-budget"); }, fetch: async request => { upstream.push(request); return new Response("Git bytes", { headers: { "Content-Type": "application/x-git-upload-pack-result", "Set-Cookie": "provider-session", Authorization: "provider-hidden" } }); } };
  return { capabilities, calls, upstream, setCurrent: (change: Partial<typeof current>) => { current = { ...current, ...change }; }, handler: assignedAgentEgress(scope, capabilities) };
}

test("agent relay allows only exact assigned fork smart Git routes and injects credentials Worker-side", async () => {
  const f = fixture();
  const response = await f.handler.fetch(new Request(`${remote}/info/refs?service=git-upload-pack`, { headers: { Authorization: "VM-stolen-value", Cookie: "VM-cookie", "X-Private-Data": "VM-header" } }));
  expect(response.status).toBe(200); expect(await response.text()).toBe("Git bytes"); expect(f.upstream.length).toBe(1); expect(f.upstream[0]?.headers.get("Authorization")).toBe("Bearer server-only-secret"); expect(f.upstream[0]?.headers.has("Cookie")).toBe(false); expect(f.upstream[0]?.headers.has("X-Private-Data")).toBe(false); expect(response.headers.has("Authorization")).toBe(false); expect(response.headers.has("Set-Cookie")).toBe(false);
  expect(f.calls).toEqual(["credential-budget:read", "credential:read", "transfer-budget"]);
  for (const url of ["https://evil.example/exfil", remote.replace("assigned-fork", "canonical-owned") + "/git-upload-pack", `${remote}/info/refs?service=git-upload-pack&token=x`, `${remote}/packages`, remote.replace("https:", "http:") + "/info/refs?service=git-upload-pack"]) expect((await f.handler.fetch(new Request(url))).status).toBe(403);
  expect(f.upstream.length).toBe(1);
});

test("write packets permit one exact assigned branch CAS and refuse deletion, tags or other branches", async () => {
  const f = fixture();
  expect(assignedAgentPushCommand(packet(), scope.branch, scope.expectedTip)).toBe(true);
  expect(parseAssignedAgentPushCommand(packet(), scope.branch, scope.expectedTip)).toEqual({ oldCommit: tip, newCommit: next, ref: "refs/heads/task/one" });
  const recorded: unknown[] = []; f.capabilities.beforeTransfer = async (_scope, push) => { recorded.push(push); };
  expect((await f.handler.fetch(new Request(`${remote}/git-receive-pack`, { method: "POST", body: packet() }))).status).toBe(200);
  for (const body of [packet(tip, "0".repeat(40)), packet(tip, next, "refs/tags/v1"), packet(tip, next, "refs/heads/main"), packet("d".repeat(40)), packet(tip, next, "refs/heads/task/one", "push-options"), new TextEncoder().encode("garbage")]) {
    expect(assignedAgentPushCommand(body, scope.branch, scope.expectedTip)).toBe(false);
    expect((await f.handler.fetch(new Request(`${remote}/git-receive-pack`, { method: "POST", body }))).status).toBe(403);
  }
  expect(recorded).toEqual([{ oldCommit: tip, newCommit: next, ref: "refs/heads/task/one" }]);
  expect(f.upstream.length).toBe(1); expect(f.upstream[0]?.headers.get("Content-Type")).toBe("application/x-git-receive-pack-request");
  expect(assignedAgentPushCommand(packet("0".repeat(40)), scope.branch, null)).toBe(true);
  expect(parseAssignedAgentPushCommand(packet("0".repeat(40)), scope.branch, null)?.oldCommit).toBeNull();
});

test("fresh actor/account/task/generation scope and actual transfer budgets fence every request", async () => {
  for (const changed of [{ actorActive: false }, { accountActive: false }, { taskActive: false }, { branchGeneration: 3 }, { forkRepoName: "other-fork" }, { expectedTip: next }]) {
    const f = fixture(); f.setCurrent(changed); expect((await f.handler.fetch(new Request(`${remote}/info/refs?service=git-upload-pack`))).status).toBe(503); expect(f.upstream.length).toBe(0); expect(f.calls.length).toBe(0);
  }
  const f = fixture(); f.capabilities.beforeTransfer = async () => { throw new Error("Funded transfer unavailable"); };
  expect((await f.handler.fetch(new Request(`${remote}/info/refs?service=git-upload-pack`))).status).toBe(503); expect(f.upstream.length).toBe(0);
  const read = fixture(), handler = assignedAgentEgress({ ...scope, access: "read" }, { ...read.capabilities, current: async () => ({ ...scope, access: "read", actorActive: true, accountActive: true, taskActive: true }) });
  expect((await handler.fetch(new Request(`${remote}/git-receive-pack`, { method: "POST", body: packet() }))).status).toBe(403);
});

test("credential substitution and authorization withdrawal after transfer never release Git response bytes", async () => {
  const wrong = fixture(); wrong.capabilities.credential = async () => ({ repositoryName: "canonical-owned", remote, scope: "read", token: "server-only-secret", expiresAt: Date.now() + 60000 });
  expect((await wrong.handler.fetch(new Request(`${remote}/info/refs?service=git-upload-pack`))).status).toBe(503); expect(wrong.upstream.length).toBe(0);
  const revoked = fixture(); revoked.capabilities.fetch = async () => { revoked.setCurrent({ actorActive: false }); return new Response("private Git bytes"); };
  const response = await revoked.handler.fetch(new Request(`${remote}/info/refs?service=git-upload-pack`)); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private Git bytes");
});

test("agent intercept installation covers HTTP and HTTPS and returns Internet disabled", async () => {
  const calls: string[] = [], binding = { fetch: async () => new Response("denied", { status: 403 }) } as unknown as Fetcher;
  const options = await installAssignedAgentEgress({ interceptAllOutboundHttp: async provided => { expect(provided).toBe(binding); calls.push("HTTP-all"); }, interceptOutboundHttps: async (host, provided) => { expect(host).toBe("*"); expect(provided).toBe(binding); calls.push("HTTPS-all"); } }, binding);
  expect(calls).toEqual(["HTTP-all", "HTTPS-all"]); expect(options).toEqual({ enableInternet: false }); expect(JSON.stringify(options)).not.toContain("secret");
});
