import {z} from 'zod';
import {gitAuthEnv,q} from './shell';
import {validateRecoveryRemote} from './private-recovery-bundle';
import {isSafeRef} from '../core/sanitize';
import type {BranchGitExecutor} from './branch-git';
/** Read-only native proof. Retargeting never implicitly rewrites the author's branch. */
export async function inspectTaskRetarget(executor:BranchGitExecutor,input:{remote:string;token:string;branch:string;head:string;base:string;directory:string}):Promise<{head:string;base:string;ancestryVerified:true}|'target_object_unavailable'|'target_not_ancestor'>{
 const sha=z.string().regex(/^[a-f0-9]{40}$/).refine(value=>!/^0{40}$/.test(value));sha.parse(input.head);sha.parse(input.base);if(!isSafeRef(input.branch))throw Error('Unsafe contribution branch');validateRecoveryRemote(input.remote);
 const ref=`refs/heads/${input.branch}`,run=async(command:string)=>{await executor.beforeCommand('before');const result=await executor.exec(command,gitAuthEnv(input.token));await executor.beforeCommand('after');return result;};
 const observe=async()=>{const result=await run(`git ls-remote --refs ${q(input.remote)} ${q(ref)}`);if(!result.success||result.stdout.trim()!==`${input.head}\t${ref}`)throw Error('Exact contribution head changed or unavailable');};
 await observe();let result=await run(`git init --quiet --bare ${q(input.directory)} && git -C ${q(input.directory)} fetch --quiet --no-tags ${q(input.remote)} ${q(input.head)}`);if(!result.success)throw Error('Original contribution object unavailable');
 result=await run(`git -C ${q(input.directory)} cat-file -e ${q(`${input.base}^{commit}`)}`);if(!result.success){result=await run(`git -C ${q(input.directory)} fetch --quiet --no-tags ${q(input.remote)} ${q(input.base)}`);if(!result.success)return 'target_object_unavailable';}
 result=await run(`git -C ${q(input.directory)} rev-parse --verify ${q(`${input.base}^{commit}`)}`);if(!result.success||result.stdout.trim()!==input.base)throw Error('Exact target commit unavailable');
 result=await run(`if git -C ${q(input.directory)} merge-base --is-ancestor ${q(input.base)} ${q(input.head)}; then printf ancestor; else retarget_status=$?; if [ "$retarget_status" -eq 1 ]; then printf not-ancestor; else exit "$retarget_status"; fi; fi`);if(!result.success||!['ancestor','not-ancestor'].includes(result.stdout.trim()))throw Error('Native ancestry inspection unavailable');
 await observe();return result.stdout.trim()==='ancestor'?{head:input.head,base:input.base,ancestryVerified:true}:'target_not_ancestor';
}
