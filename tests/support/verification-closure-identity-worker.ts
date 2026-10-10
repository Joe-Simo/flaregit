import {RepositoryController} from '../../src/server/durable-object';
import {PrivateRecoveryOperations} from '../../src/server/private-recovery';
import {IntegrationNativeRuntimeLedger} from '../../src/server/integration-native-runtime';
import {VERIFIER_IDENTITIES} from '../../src/core/verification-identities';
import {accountKeyFor} from '../../src/server/projects';
import type {Env} from '../../src/server/env';
type Mode='command-custom'|'command-git-integrity'|'git-integrity';
/** Seeds one stopped native verification run and closes it through the production closure path. */
export class VerificationClosureIdentityFixture extends RepositoryController{
 async closeFor(mode:Mode):Promise<{ok:boolean;error?:string;closures:number}>{
  const policy=mode==='git-integrity'?{kind:'git-integrity' as const}:{kind:'command' as const,test:'bun test'};
  const state=await this.initialize({projectId:'p123456789abc',projectName:'Closure identity fixture',canonicalRepoName:'synthetic-only',head:'a'.repeat(40),verificationPolicy:policy,ownerId:'owner'});
  const incarnation=new PrivateRecoveryOperations(this.ctx.storage).incarnation();await this.registerWorkflow('workflow','integration',undefined,'owner',1);
  state.candidates.candidate={id:'candidate',workflowInstanceId:'workflow',candidateCommit:'b'.repeat(40),evidenceId:'evidence',preservationProtocolVersion:1,attemptNumber:1,participatingTaskIds:[],participatingCommits:{},expectedAcceptedBase:'a'.repeat(40),frozenPolicyVersion:1,frozenVerificationPolicy:policy,frozenRequirements:[],repairAttempts:[],status:'verified',createdAt:'now',updatedAt:'now'};
  state.evidence.evidence={id:'evidence',candidateCommit:'b'.repeat(40),candidateTree:'c'.repeat(40),expectedAcceptedBase:'a'.repeat(40),requirementsVersion:1,policy,testBundleDigest:'d'.repeat(64),toolchainDigest:'e'.repeat(64),builtOutputDigest:'f'.repeat(64),verifierIdentity:mode==='command-custom'?VERIFIER_IDENTITIES.custom:VERIFIER_IDENTITIES['git-integrity'],testResults:[],timestamp:'now',status:'passed'};
  this.ctx.storage.sql.exec('UPDATE project SET doc=? WHERE id=1',JSON.stringify(state));
  const scope={workflowId:'workflow',candidateId:'candidate',projectId:state.projectId,incarnation,actorId:'owner',accountKey:await accountKeyFor('owner')},runtime=new IntegrationNativeRuntimeLedger(this.ctx.storage),nativeId=crypto.randomUUID(),commandId=crypto.randomUUID();
  runtime.declareCoverage(scope);runtime.reserve(scope,nativeId,'integrate-candidate');runtime.admitCommand(scope,nativeId,commandId);runtime.finishCommand(scope,nativeId,commandId,{outcome:'completed'});runtime.confirmStopped(scope,nativeId,{nativeRunId:nativeId,state:'stopped'});
  let result:{ok:boolean;error?:string};
  try{await this.closeIntegrationVerification('workflow','candidate','b'.repeat(40),'evidence');result={ok:true};}catch(error){result={ok:false,error:error instanceof Error?error.message:String(error)};}
  const table=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='integration_verification_closures'").toArray().length>0;
  return{...result,closures:table?this.ctx.storage.sql.exec("SELECT 1 FROM integration_verification_closures WHERE workflow_id='workflow'").toArray().length:0};
 }
}
export default{async fetch(request:Request,env:Env){const mode=new URL(request.url).pathname.slice(1) as Mode;return Response.json(await(env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as VerificationClosureIdentityFixture).closeFor(mode));}};
