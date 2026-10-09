/** F16 slice: agent tool allowlist. An agent may call only tools its task grants, and never outside the task's repository. */

export interface AgentGrant {
  readonly repository: string;
  readonly tools: readonly string[];
}

export function agentMayCall(grant: AgentGrant, tool: string, repository: string): boolean {
  return grant.repository === repository && grant.tools.includes(tool);
}
