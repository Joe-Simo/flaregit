import {z} from "zod";
import {apiJson} from "./api";
import type {GitGatewayRecoveryReport} from "../server/git-gateway-recovery";
const reportSchema=z.object({coverage:z.enum(["recorded","unknown"]),pendingCount:z.number().int().nonnegative().nullable(),quiescent:z.boolean(),attempts:z.array(z.object({id:z.uuid(),credential:z.enum(["issuance_unknown","cleanup_pending","revoked"]),transfer:z.enum(["not_dispatched","completed","open_unverified","outcome_unknown"])}).strict()).max(20),nextCursor:z.string().regex(/^[1-9][0-9]{0,15}$/).nullable(),complete:z.boolean(),source:z.literal("recorded-ledger"),providerVerified:z.literal(false)}).strict().refine(value=>value.coverage==="unknown"?value.pendingCount===null&&!value.quiescent:value.pendingCount!==null&&(!value.quiescent||value.pendingCount===0));
export function parseGitTransferRecovery(value:unknown):GitGatewayRecoveryReport{return reportSchema.parse(value);}
export function needsGitTransferRecovery(report:GitGatewayRecoveryReport):boolean{return report.coverage==="unknown"||report.pendingCount!==0||!report.quiescent;}
export async function readGitTransferRecovery(projectId:string,taskId:string,signal:AbortSignal,cursor?:string):Promise<GitGatewayRecoveryReport>{
 if(!/^[a-z0-9]{12,16}$/.test(projectId)||! /^[a-z0-9][a-z0-9-]{0,100}$/.test(taskId)||cursor!==undefined&&!/^[1-9][0-9]{0,15}$/.test(cursor))throw Error("Invalid Git transport recovery scope");
 const query=cursor?`?cursor=${encodeURIComponent(cursor)}`:"";return parseGitTransferRecovery(await apiJson<unknown>(`/p/${projectId}/tasks/${taskId}/git-recovery${query}`,{signal}));
}
export const gitTransferLabel=(state:GitGatewayRecoveryReport["attempts"][number]["transfer"])=>({not_dispatched:"Not dispatched",completed:"HTTP transfer completed",open_unverified:"Transfer closure unconfirmed",outcome_unknown:"Transfer outcome unknown"})[state];
export const gitCredentialLabel=(state:GitGatewayRecoveryReport["attempts"][number]["credential"])=>({issuance_unknown:"Credential issuance unconfirmed",cleanup_pending:"Credential cleanup pending",revoked:"Credential revocation recorded"})[state];
