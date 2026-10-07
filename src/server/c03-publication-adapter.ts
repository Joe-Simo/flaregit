import {C03PublicationDriver,type C03PublicationDriverBounds} from './c03-publication-driver';
import {c03PublicationScopeSchema,type C03CheckpointSql,type C03PublicationScope} from './c03-publication-checkpoints';
import {assertIntegrationPublicationTarget} from './workflow';
import {publicationInHistory} from './publication';
import type {CandidateGeneration,PublicationJournalEntry,FlareGitProjectState} from '../core/types';
import type {Ledger} from './durable-object';
export interface C03ProductionPublicationBinding{
 scope:C03PublicationScope;
 candidate:CandidateGeneration;
 journal:PublicationJournalEntry;
 state:Pick<FlareGitProjectState,'projectId'|'canonicalRepoName'|'defaultBranch'>;
 ledger:Ledger;
 /** Read current server configuration/Worker metadata, never request input. */
 runtimeRelease():{workerVersion:string;sourceVersion:string};
 /** Bind the actual Workflow casPush implementation. Its retained credentials,
  * native dispatch authorization and compare-and-swap stay authoritative. */
 publish(candidate:CandidateGeneration,commit:string,ledger:Ledger,branch:string,journal:PublicationJournalEntry):Promise<{ok:true;readbackScope?:string}|{ok:false;error:string;stale?:boolean}>;
 readback:{exec:Parameters<typeof publicationInHistory>[0];directory:string;remote:string;token:string};
 retainBackground?(work:Promise<void>):void;
}
/** Private owner-bound orchestration; this adapter grants no human approval and
 * is not a public fault-injection or publication API. */
export function createC03PublicationAdapter(sql:C03CheckpointSql,input:C03ProductionPublicationBinding,bounds:C03PublicationDriverBounds={}){
 const scope=c03PublicationScopeSchema.parse(structuredClone(input.scope)),candidate=structuredClone(input.candidate),journal=structuredClone(input.journal),state=structuredClone(input.state),branch=scope.ref.slice('refs/heads/'.length);
 if(scope.projectId!==state.projectId||scope.candidateId!==candidate.id||candidate.candidateCommit!==scope.commit||journal.candidateId!==candidate.id||journal.candidateCommit!==scope.commit||journal.newHead!==scope.commit||journal.candidateTree!==scope.tree||journal.state!=='PREPARED'||journal.publicationAuthority?.commit!==scope.commit||journal.publicationAuthority.tree!==scope.tree||candidate.acceptedTarget?.incarnation!==scope.incarnation)throw Error('Original reviewed publication binding differs');
 const assert=()=>assertIntegrationPublicationTarget(candidate,journal,state,scope.commit,branch);
 assert();
 const release=()=>{const current=input.runtimeRelease();if(current.workerVersion!==scope.workerVersion||current.sourceVersion!==scope.sourceVersion)throw Error('Original publication runtime release changed');};
 const same=(current:C03PublicationScope)=>{if(JSON.stringify(current)!==JSON.stringify(scope))throw Error('Original publication driver scope differs');assert();};
 return new C03PublicationDriver(sql,{
  authorize:async current=>{same(current);release();if(!await input.ledger.authorizeCandidatePublication(candidate.id,scope.commit))throw Error('Original owner publication authority unavailable');same(current);release();},
  // Driver commandId is orchestration identity; casPush retains the actual
  // production journal/dispatch ledger identity and final authorization.
  publish:async current=>{same(current);release();const result=await input.publish(structuredClone(candidate),scope.commit,input.ledger,branch,structuredClone(journal));if(!result.ok)throw Error('Production publication remains unconfirmed');},
  readback:async current=>{same(current);return publicationInHistory(input.readback.exec,input.readback.directory,input.readback.remote,input.readback.token,branch,scope.commit,candidate.expectedAcceptedBase===null);},
  ...(input.retainBackground?{retainBackground:input.retainBackground}:{}),
 },bounds);
}
