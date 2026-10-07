import { z } from "zod";
import { isSafeRef } from "../core/sanitize";
import { validateRecoveryRemote } from "./private-recovery-bundle";
import { executionEgress, type ExecutionEgressFetch, type ExecutionEgressRule } from "./execution-egress";

const text = z.string().min(1).max(256).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const sha = z.string().regex(/^[a-f0-9]{40}$/).refine(value => !/^0{40}$/.test(value));
export const agentExecutionEgressScopeSchema = z.object({ projectId: text, incarnation: z.uuid(), actorId: text, accountKey: text, taskId: text, runId: text, workflowId: text, branchGeneration: z.number().int().nonnegative().safe(), canonicalRepoName: text, forkRepoName: text, remote: z.string().max(2048), branch: z.string().refine(value => isSafeRef(value) && !value.startsWith("refs/") && value !== "HEAD"), expectedTip: sha.nullable(), access: z.enum(["read", "write"]) }).strict().refine(value => value.forkRepoName !== value.canonicalRepoName, "Agent writes must stay in the assigned fork");
const scopeSchema = agentExecutionEgressScopeSchema;
export type AgentExecutionEgressScope = z.infer<typeof agentExecutionEgressScopeSchema>;
export interface AgentExecutionEgressSnapshot extends AgentExecutionEgressScope { actorActive: boolean; accountActive: boolean; taskActive: boolean }
export interface AgentExecutionGitCredential { repositoryName: string; remote: string; scope: "read" | "write"; token: string; expiresAt: number }
export interface AgentExecutionEgressCapabilities {
  /** Fresh server-ledger snapshot, including writer membership and bound generation. */
  current(scope: AgentExecutionEgressScope): Promise<AgentExecutionEgressSnapshot>;
  beforeCredential(scope: AgentExecutionEgressScope, access: "read" | "write"): Promise<void>;
  credential(scope: AgentExecutionEgressScope, access: "read" | "write"): Promise<AgentExecutionGitCredential>;
  beforeTransfer(scope: AgentExecutionEgressScope, push?: AgentAssignedPush): Promise<void>;
  fetch: ExecutionEgressFetch;
}

/** Validate the receive command section only; Git itself validates the opaque
 * pack. One exact assigned branch, old-tip CAS and nondeletion are mandatory.
 * No tag, canonical ref, push-options or multi-ref update can pass this boundary.
 */
export interface AgentAssignedPush { oldCommit: string | null; newCommit: string; ref: string }
export function parseAssignedAgentPushCommand(body: Uint8Array, branch: string, expectedTip: string | null): AgentAssignedPush | null {
  if (!isSafeRef(branch) || branch.startsWith("refs/") || branch === "HEAD" || (expectedTip !== null && (!/^[a-f0-9]{40}$/.test(expectedTip) || /^0{40}$/.test(expectedTip)))) return null;
  if (body.byteLength < 4 || body.byteLength > 1048576) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let offset = 0, commands = 0, parsed: AgentAssignedPush | null = null;
  try {
    while (offset + 4 <= body.byteLength) {
      const sizeText = decoder.decode(body.subarray(offset, offset + 4));
      if (!/^[a-f0-9]{4}$/i.test(sizeText)) return null;
      const size = parseInt(sizeText, 16); offset += 4;
      if (size === 0) return commands === 1 ? parsed : null; // Remaining bytes are the bounded opaque pack.
      if (size < 4 || offset + size - 4 > body.byteLength || ++commands > 1) return null;
      const line = decoder.decode(body.subarray(offset, offset + size - 4)); offset += size - 4;
      const [command, capabilities, extra] = line.replace(/\n$/, "").split("\0");
      if (extra !== undefined || capabilities?.split(" ").some(value => value === "push-options")) return null;
      const match = /^([a-f0-9]{40}) ([a-f0-9]{40}) (refs\/heads\/[A-Za-z0-9._/-]+)$/.exec(command ?? "");
      if (!match || match[1] !== (expectedTip ?? "0".repeat(40)) || /^0{40}$/.test(match[2]!) || match[3] !== `refs/heads/${branch}`) return null;
      parsed = { oldCommit: expectedTip, newCommit: match[2]!, ref: match[3]! };
    }
  } catch { return null; }
  return null;
}
export function assignedAgentPushCommand(body: Uint8Array, branch: string, expectedTip: string | null): boolean {
  return parseAssignedAgentPushCommand(body, branch, expectedTip) !== null;
}

function sameScope(first: AgentExecutionEgressScope, second: AgentExecutionEgressScope): boolean {
  return (Object.keys(first) as Array<keyof AgentExecutionEgressScope>).every(key => first[key] === second[key]);
}
/** Worker-only relay. Credentials and callbacks must never be serialized into
 * VM start options, env, command arguments or props supplied to contributor code.
 */
export function assignedAgentEgress(input: AgentExecutionEgressScope, capabilities: AgentExecutionEgressCapabilities) {
  const scope = scopeSchema.parse(input); validateRecoveryRemote(scope.remote);
  const remote = new URL(scope.remote), path = remote.pathname.replace(/\/$/, "");
  const authorize = async () => {
    const current = await capabilities.current(scope);
    const { actorActive, accountActive, taskActive, ...identity } = current, parsed = scopeSchema.parse(identity);
    if (actorActive !== true || accountActive !== true || taskActive !== true || !sameScope(scope, parsed)) throw new Error("Agent execution scope changed");
  };
  const headers = (access: "read" | "write", endpoint: string, method: "GET" | "POST") => async () => {
    await authorize(); await capabilities.beforeCredential(scope, access); await authorize();
    const credential = await capabilities.credential(scope, access);
    if (credential.repositoryName !== scope.forkRepoName || credential.remote !== scope.remote || credential.scope !== access || !Number.isSafeInteger(credential.expiresAt) || credential.expiresAt <= Date.now() || credential.expiresAt > Date.now() + 305000 || !credential.token || credential.token.length > 16384 || /[\x00-\x20\x7f]/.test(credential.token)) throw new Error("Assigned fork credential unavailable");
    await authorize();
    const result = new Headers({ Authorization: `Bearer ${credential.token}`, "Git-Protocol": "version=1" });
    if (method === "POST") result.set("Content-Type", endpoint === "git-receive-pack" ? "application/x-git-receive-pack-request" : "application/x-git-upload-pack-request");
    return result;
  };
  const rule = (endpoint: string, method: "GET" | "POST", access: "read" | "write", query?: ExecutionEgressRule["query"]): ExecutionEgressRule => ({ origin: remote.origin, path: `${path}/${endpoint}`, method, query, maxRequestBytes: method === "GET" ? 0 : 1048576, maxResponseBytes: 16777216, headers: headers(access, endpoint, method) });
  const rules = [rule("info/refs", "GET", "read", "?service=git-upload-pack"), rule("git-upload-pack", "POST", "read")];
  if (scope.access === "write") rules.push(rule("info/refs", "GET", "write", "?service=git-receive-pack"), rule("git-receive-pack", "POST", "write"));
  const transfer: ExecutionEgressFetch = async request => {
    let push: AgentAssignedPush | undefined;
    if (new URL(request.url).pathname === `${path}/git-receive-pack`) {
      const parsed = parseAssignedAgentPushCommand(new Uint8Array(await request.clone().arrayBuffer()), scope.branch, scope.expectedTip);
      if (!parsed) return new Response("Assigned branch push refused", { status: 403 });
      push = parsed;
    }
    await authorize(); await capabilities.beforeTransfer(scope, push); await authorize();
    const response = await capabilities.fetch(request); await authorize(); return response;
  };
  return executionEgress(rules, transfer, authorize);
}

/** Install through a real Worker service binding before start. HTTP and HTTPS
 * catches are both necessary; Internet=false also denies other ports and DNS bypass.
 * Packages and arbitrary provider domains remain unsupported in managed execution.
 * BYO agents/CI keep their own runtime/network and existing Git contribution path.
 */
export async function installAssignedAgentEgress(container: Pick<Container, "interceptAllOutboundHttp" | "interceptOutboundHttps">, binding: Fetcher): Promise<{enableInternet:false}> {
  await container.interceptAllOutboundHttp(binding);
  await container.interceptOutboundHttps("*", binding);
  return { enableInternet: false };
}
