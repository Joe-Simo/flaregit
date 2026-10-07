import type {CoreGitAdmission} from './core-git-budget';
import {RepositoryReadError} from './repository-read-budget';
/** One exact head observation is bounded to eight logical provider attempts.
 * Unknown reservation outcomes remain held; this group never retries admission.
 * Credential cleanup uses its own independent group after authority withdrawal. */
export function taskReadyReadFunding(operationId:string,reserve:(id:string)=>Promise<CoreGitAdmission>){let calls=0,reservation:Promise<CoreGitAdmission>|null=null;return async()=>{if(calls>=8)throw new RepositoryReadError(413,'provider_limit');calls++;reservation??=reserve(operationId);const result=await reservation;if(!result.allowed)throw new RepositoryReadError(result.reason==='unconfigured'?503:429,result.reason);};}
