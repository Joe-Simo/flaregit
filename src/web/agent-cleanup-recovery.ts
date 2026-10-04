import {array,boolean,enum as enumSchema,int,literal,maxLength,minLength,minimum,regex,strictObject,string,uuid,type infer as Infer} from 'zod/mini';
import {apiJson} from './api';
const credentialStatus=enumSchema(['issuance_unknown','pending','revoked','expired_unverified']);
const attempt=strictObject({attemptId:uuid(),workflowId:string().check(minLength(1),maxLength(200),regex(/^[A-Za-z0-9_-]+$/)),runId:string().check(minLength(1),maxLength(200),regex(/^[A-Za-z0-9_-]+$/)),taskId:string().check(minLength(1),maxLength(200),regex(/^[A-Za-z0-9_-]+$/)),phase:enumSchema(['proposal','apply']),generation:int().check(minimum(0)),stopped:boolean(),credentialStatuses:array(credentialStatus).check(maxLength(1000))});
const reportSchema=strictObject({attempts:array(attempt).check(maxLength(20)),truncated:boolean(),providerVerified:literal(false)});
const resultSchema=strictObject({stopped:boolean(),credentialsComplete:boolean()});
export type AgentCleanupAttempt=Infer<typeof attempt>;
export type AgentCleanupReport=Infer<typeof reportSchema>;
export type AgentCleanupResult=Infer<typeof resultSchema>;
export function checkedAgentCleanupReport(value:unknown):AgentCleanupReport{const report=reportSchema.parse(value);if(new Set(report.attempts.map(row=>row.attemptId)).size!==report.attempts.length||report.attempts.some(row=>row.stopped&&row.credentialStatuses.every(status=>status==='revoked')))throw Error('Pending cleanup inventory was not confirmed.');return report;}
export function checkedAgentCleanupResult(value:unknown):AgentCleanupResult{return resultSchema.parse(value);}
export async function readAgentCleanup(projectId:string,signal:AbortSignal):Promise<AgentCleanupReport>{return checkedAgentCleanupReport(await apiJson<unknown>(`/p/${projectId}/agent-runtime/recovery`,{signal}));}
export async function checkAgentCleanup(projectId:string,attemptId:string,signal:AbortSignal):Promise<AgentCleanupResult>{uuid().parse(attemptId);return checkedAgentCleanupResult(await apiJson<unknown>(`/p/${projectId}/agent-runtime/recovery`,{method:'POST',json:{attemptId},signal}));}
