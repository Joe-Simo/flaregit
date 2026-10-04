import type {Env} from './env';
import type {RestrictedAgentRuntime} from './agent-run';
import {agentNativeAttemptSchema,type AgentNativeAttemptIdentity} from './agent-runtime-ledger';

/** Runtime records also carry timestamps/status. Only validated ownership fields
 * cross the configuration RPC; observed status never grants execution authority. */
function identity(attempt:AgentNativeAttemptIdentity){return agentNativeAttemptSchema.strip().parse(structuredClone(attempt));}

export function restrictedAgentRuntimeOptions(env:Env):{restrictedEgress?:true;restrictedRuntime?:RestrictedAgentRuntime}{
  if(env.AGENT_RESTRICTED_EGRESS_ENABLED!==undefined&&env.AGENT_RESTRICTED_EGRESS_ENABLED!=='false'&&env.AGENT_RESTRICTED_EGRESS_ENABLED!=='true')throw Error('Invalid restricted agent rollout configuration');
  if(env.AGENT_RESTRICTED_EGRESS_ENABLED!=='true')return {};
  const sandbox=(attempt:AgentNativeAttemptIdentity)=>env.AGENT.getByName(`agent-${attempt.nativeId}`);
  return {restrictedEgress:true,restrictedRuntime:{
    configure:(attempt,scope)=>sandbox(attempt).configureRestrictedAgent(identity(attempt),structuredClone(scope)),
    assertConfigured:(attempt,scope)=>sandbox(attempt).assertRestrictedAgent(identity(attempt),structuredClone(scope)),
    cleanup:attempt=>sandbox(attempt).cleanupRestrictedAgent(identity(attempt)),
  }};
}
