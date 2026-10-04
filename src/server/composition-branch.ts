import {isSafeRef} from "../core/sanitize";
import {gitAuthEnv,q} from "./shell";
/** Select the saved canonical branch only after an exact native remote observation. */
export async function confirmCompositionBranch(options:{branch:string|undefined;expectedBase:string;remote:string;token:string;directory:string;exec(command:string,env?:Record<string,string>):Promise<{success:boolean;stdout:string}>;beforeCommand(phase:"before"|"after"):Promise<void>}):Promise<string>{
 const {branch,expectedBase}=options;
 if(!branch||!isSafeRef(branch)||!/^([a-f0-9]{40})$/.test(expectedBase))throw new Error("Saved canonical branch identity is unavailable");
 const ref=`refs/heads/${branch}`;await options.beforeCommand("before");const result=await options.exec(`git -C ${q(options.directory)} ls-remote --refs ${q(options.remote)} ${q(ref)}`,gitAuthEnv(options.token));await options.beforeCommand("after");
 if(!result.success)throw new Error("Canonical branch observation is unavailable");
 const rows=result.stdout.trim().split("\n").filter(Boolean);
 if(rows.length!==1||rows[0]!==`${expectedBase}\t${ref}`)throw new Error("Canonical branch differs from the frozen accepted base; saved contributions remain preserved");
 return branch;
}
