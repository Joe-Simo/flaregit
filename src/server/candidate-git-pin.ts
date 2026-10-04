import {validateRecoveryRemote} from "./private-recovery-bundle";
import {gitAuthEnv,q} from "./shell";
/** A frozen review candidate is retained create-only, then verified through its exact full Git ref. */
export async function retainCandidateGitPin(options:{candidateId:string;commit:string;directory:string;remote:string;token:string;beforeCommand(phase:"before"|"after"):Promise<void>;exec(command:string,env?:Record<string,string>):Promise<{success:boolean;stdout:string}>}):Promise<{ref:string;observedCommit:string}>{
 if(!/^[A-Za-z0-9_-]{1,200}$/.test(options.candidateId)||!/^[a-f0-9]{40}$/.test(options.commit)||/^0{40}$/.test(options.commit))throw Error("Exact frozen candidate identity required");
 validateRecoveryRemote(options.remote);
 const ref=`refs/flaregit/candidates/${options.candidateId}`;
 const run=async(command:string)=>{await options.beforeCommand("before");const result=await options.exec(command,gitAuthEnv(options.token));await options.beforeCommand("after");return result;};
 const inspect=async()=>{const result=await run(`git -C ${q(options.directory)} ls-remote --refs ${q(options.remote)} ${q(ref)}`);if(!result.success)throw Error("Candidate preservation readback unavailable");const rows=result.stdout.trim().split("\n").filter(Boolean);if(rows.length===0)return false;if(rows.length!==1||rows[0]!==`${options.commit}\t${ref}`)throw Error("Protected candidate ref differs from the verified commit");return true;};
 if(!await inspect()){
   // A missing expected old value permits only creation, even if another writer races this observation.
   try{await run(`git -C ${q(options.directory)} push --quiet --force-with-lease=${q(`${ref}:`)} ${q(options.remote)} ${q(`${options.commit}:${ref}`)}`);}catch{/* A lost acknowledgement is settled only by exact readback below. */}
   if(!await inspect())throw Error("Candidate preservation was not confirmed; review remains pending");
 }
 return{ref,observedCommit:options.commit};
}
