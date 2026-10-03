import type { TaskStatus } from '@/core/types';
export interface ChangeCreationResponse { commands: string[]; replayed: boolean; terminal: boolean; status: TaskStatus; agentRunId: string | null }
const statuses: readonly TaskStatus[] = ['working', 'checkpointed', 'ready', 'integrating', 'verifying', 'accepted', 'needs_decision', 'blocked', 'cancelled'];
/** An acknowledged replay must never restart a terminal change or an existing run. */
export function changeCreationFollowup(response: ChangeCreationResponse, useAgent: boolean): 'terminal' | 'existing-agent' | 'start-agent' | 'git' {
  if (!statuses.includes(response.status) || typeof response.replayed !== 'boolean' || typeof response.terminal !== 'boolean' || !(response.agentRunId === null || typeof response.agentRunId === 'string' && response.agentRunId.length > 0) || !Array.isArray(response.commands) || response.commands.some(command => typeof command !== 'string')) throw new Error('The saved change response could not be verified. Retry this same request.');
  const terminal = response.status === 'accepted' || response.status === 'cancelled';
  if (response.terminal !== terminal) throw new Error('The saved change status is inconsistent. Retry this same request.');
  if (terminal) return 'terminal';
  if (response.agentRunId) return 'existing-agent';
  if (useAgent && ['working', 'checkpointed', 'blocked', 'needs_decision'].includes(response.status)) return 'start-agent';
  return 'git';
}
