import {validateRecoveryRemote} from "./private-recovery-bundle";
import {isSafeRef} from "../core/sanitize";
import {gitAuthEnv,q} from "./shell";
import {branchCreationSchema,type BranchCreationIdentity} from "./branch-creation-operations";
export interface BranchGitExecutor{exec(command:string,env?:Record<string,string>):Promise<{success:boolean;stdout:string}>;beforeCommand(phase:"before"|"after"):Promise<void>}
export function parseBranchInventory(stdout:string,limit=200):{branches:Array<{name:string;ref:string;commit:string}>;truncated:boolean}{if(!Number.isSafeInteger(limit)||limit<1||limit>200||new TextEncoder().encode(stdout).length>1024*1024)throw Error("Branch inventory inspection limit reached");const rows=stdout.trim().split("\n").filter(Boolean),branches:Array<{name:string;ref:string;commit:string}>=[],seen=new Set<string>();for(const row of rows){const match=/^([a-f0-9]{40})\trefs\/heads\/(.+)$/.exec(row);if(!match||!isSafeRef(match[2]!)||seen.has(match[2]!))throw Error("Branch advertisement unavailable");seen.add(match[2]!);if(branches.length<limit)branches.push({name:match[2]!,ref:`refs/heads/${match[2]!}`,commit:match[1]!});}return{branches,truncated:rows.length>limit};}
export async function inspectNativeBranches(executor:BranchGitExecutor,remote:string,token:string,limit=200){validateRecoveryRemote(remote);await executor.beforeCommand("before");const result=await executor.exec(`git ls-remote --heads ${q(remote)}`,gitAuthEnv(token));await executor.beforeCommand("after");if(!result.success)throw Error("Branch advertisement unavailable");return parseBranchInventory(result.stdout,limit);}
/** Git-only create operation. Caller owns durable scoped credentials/lifetime and exact authorization. */
export async function createNativeBranch(executor:BranchGitExecutor,options:{identity:BranchCreationIdentity;remote:string;token:string;directory:string;dispatch:"prepared"|"unknown";markDispatch():Promise<void>}):Promise<{status:"confirmed"|"existing"|"different"|"unknown";observedCommit?:string}>{
 validateRecoveryRemote(options.remote);
 const identity=branchCreationSchema.parse(options.identity),ref=`refs/heads/${identity.branch}`;
 const run=async(command:string)=>{await executor.beforeCommand("before");const result=await executor.exec(command,gitAuthEnv(options.token));await executor.beforeCommand("after");return result;};
 const observe=async()=>{const response=await run(`git ls-remote --refs ${q(options.remote)} ${q(ref)}`);if(!response.success)throw Error("Branch readback unavailable");const rows=response.stdout.trim().split("\n").filter(Boolean);if(!rows.length)return null;if(rows.length!==1||!new RegExp(`^[a-f0-9]{40}\\t`).test(rows[0]!)||rows[0]!.slice(41)!==ref)throw Error("Branch readback identity unavailable");return rows[0]!.slice(0,40);};
 const previous=await observe();if(previous)return{status:options.dispatch==="unknown"&&previous===identity.sourceCommit?"confirmed":previous===identity.sourceCommit?"existing":"different",observedCommit:previous};
 if(options.dispatch==="unknown")return {status:"unknown"};
 const fetched=await run(`git init --quiet --bare ${q(options.directory)} && git -C ${q(options.directory)} fetch --quiet --no-tags ${q(options.remote)} ${q(identity.acceptedCommit)}`);if(!fetched.success)throw Error("Accepted ancestry unavailable");
 const source=await run(`git -C ${q(options.directory)} rev-parse --verify ${q(`${identity.sourceCommit}^{commit}`)}`);if(!source.success||source.stdout.trim()!==identity.sourceCommit)throw Error("Branch source commit unavailable");
 const ancestor=await run(`git -C ${q(options.directory)} merge-base --is-ancestor ${q(identity.sourceCommit)} ${q(identity.acceptedCommit)}`);if(!ancestor.success)throw Error("Branch source is outside accepted ancestry");
 await options.markDispatch();await run(`git -C ${q(options.directory)} push --quiet --force-with-lease=${q(`${ref}:`)} ${q(options.remote)} ${q(`${identity.sourceCommit}:${ref}`)}`);
 const observed=await observe();return observed===identity.sourceCommit?{status:"confirmed",observedCommit:observed}:observed?{status:"different",observedCommit:observed}:{status:"unknown"};
}
