import {DurableObject} from "cloudflare:workers";
import worker from '../../src/server/worker';
import {RepositoryController} from '../../src/server/durable-object';
import {accountKeyFor} from '../../src/server/projects';
import {ImportHistoryAttempts} from '../../src/server/import-history-attempts';
import type {Env} from '../../src/server/env';
const projectId='p123456789abc',head='a'.repeat(40),canonicalRepoName='fixture';
const calls:string[]=[];let lastDispatch:unknown=null;let providerStatus='unavailable';
export class HistoryNativeFixture extends DurableObject {
 async destroy(){await this.ctx.storage.put('destroyCalls',Number(await this.ctx.storage.get('destroyCalls')??0)+1);}
 async lifetimeStatus(){return {state:await this.ctx.storage.get('knownStopped')?'stopped':'unknown'};}
 async knownStopped(){await this.ctx.storage.put('knownStopped',true);}
 async snapshot(){return {destroyCalls:Number(await this.ctx.storage.get('destroyCalls')??0)};}
}
export class HistoryHttpFixture extends RepositoryController {
 constructor(ctx:DurableObjectState,env:Env){
  const workflow={get:async(id:string)=>({status:async()=>{calls.push(`status:${id}`);if(providerStatus==='unavailable')throw Error('Synthetic missing handle');return {status:providerStatus};}})};
  super(ctx,{...env,IMPORT_HISTORY_WORKFLOW:workflow} as unknown as Env);
 }

 async driftBranch(){const state=await super.getState();state.defaultBranch='release';this.ctx.storage.sql.exec('UPDATE project SET doc=? WHERE id=1',JSON.stringify(state));}
 driftJob(){this.ctx.storage.sql.exec("UPDATE import_jobs SET doc=json_set(doc,'$.importedBranch','release') WHERE id=?",projectId);}

 async moveAcceptedHead(){await this.ctx.storage.put('syntheticAcceptedHead','b'.repeat(40));}
 override async getState(){const state=await super.getState();const moved=await this.ctx.storage.get<string>('syntheticAcceptedHead');return moved?{...state,acceptedState:{...state.acceptedState,currentCommit:moved}}:state;}
 async cleanupAttempt(id:string,mode:string){const key=await accountKeyFor('owner');await this.beginHistoryInspection(id,key,head);const ledger=new ImportHistoryAttempts(this.ctx.storage);const first=ledger.start(id,0);if(mode==='saved')return first;ledger.observed(id,1,'terminated');ledger.nativeStopped(id,1,first.nativeRunId);const latest=ledger.start(id,1);ledger.dispatchUnknown(id,2);if(mode==='native-unknown')ledger.nativeAllocationIntent(id,2);return latest;}
 nativePossible(id:string){const ledger=new ImportHistoryAttempts(this.ctx.storage),attempt=ledger.get(id)!;return ledger.nativeAllocationIntent(id,attempt.generation);}
 async pauseNative(id:string){const attempt=new ImportHistoryAttempts(this.ctx.storage).get(id)!;await this.pauseHistoryInspection(id,'native_execution_unavailable',{generation:attempt.generation,workflowId:attempt.workflowId});return attempt;}
 resetOperations(){this.ctx.storage.sql.exec("DELETE FROM import_history_operations");}
 resetInspections(){this.ctx.storage.sql.exec("DELETE FROM history_inspections;DELETE FROM history_attempts");}
 seedJob(){this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS import_jobs(id TEXT PRIMARY KEY,doc TEXT NOT NULL)');this.ctx.storage.sql.exec('INSERT OR REPLACE INTO import_jobs VALUES(?,?)',projectId,JSON.stringify({id:projectId,ownerId:'owner',status:'ready',source:'https://github.com/synthetic/repository.git',canonicalRepoName,importedHead:head,importedBranch:'main'}));}
 legacy(id:string){this.ctx.storage.sql.exec("UPDATE import_history_operations SET doc=json_remove(doc, '$.protocolVersion') WHERE instance=?",id);}
 clearInspection(id:string){this.ctx.storage.sql.exec('DELETE FROM history_inspections WHERE id=?',id);this.ctx.storage.sql.exec('DELETE FROM history_attempts WHERE op=?',id);}
 expire(id:string){const row=this.ctx.storage.sql.exec<{doc:string}>('SELECT doc FROM history_attempts WHERE op=?',id).one();const doc=JSON.parse(row.doc) as Record<string,unknown>;doc.deliveryUntil='2000-01-01T00:00:00.000Z';this.ctx.storage.sql.exec('UPDATE history_attempts SET doc=? WHERE op=?',JSON.stringify(doc),id);}
 verified(id:string){this.ctx.storage.sql.exec("UPDATE history_inspections SET status='verified',result=? WHERE id=?",JSON.stringify({status:'verified',destinationCapturedAt:'2026-10-03T00:00:00.000Z',commitsCompared:1}),id);}
}
type FixtureEnv=Omit<Env,'REPOSITORY_CONTROLLER'|'INTEGRATOR'>&{REPOSITORY_CONTROLLER:DurableObjectNamespace<HistoryHttpFixture>;FIXTURE_ISSUER:string;INTEGRATOR:DurableObjectNamespace<HistoryNativeFixture>};
export default {async fetch(request:Request,env:FixtureEnv,ctx:ExecutionContext){const url=new URL(request.url),key=await accountKeyFor('owner'),repo=env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`),account=env.REPOSITORY_CONTROLLER.getByName(`account:${key}`);
 if(url.pathname==='/fixture/seed'){await repo.initialize({projectId,projectName:'Synthetic import HTTP',canonicalRepoName,head,verificationPolicy:{},ownerId:'owner'});await repo.addMember('member','member');await account.setProfile({handle:'owner',displayName:'Synthetic owner',bio:'',joinedAt:'2026-10-03'});await account.seedJob();const token=`fgt_${key}_`+'x'.repeat(32);const created=await account.createApiToken('owner','fixture',token,{scope:'full'});return Response.json({token,tokenId:created.id});}
 if(url.pathname==='/fixture/drift'){await repo.driftBranch();await account.driftJob();return new Response('ok');}
 if(url.pathname==='/fixture/reset'){await account.resetOperations();await repo.resetInspections();calls.length=0;return new Response('ok');}
 if(url.pathname==='/fixture/claim'){const id=`import-history-${crypto.randomUUID()}`;return Response.json(await account.claimImportHistoryOperation({projectId,head,canonicalRepoName,ownerId:'owner',instanceId:id,...(url.searchParams.has('legacy')?{}:{protocolVersion:2 as const})}));}
 if(url.pathname==='/fixture/cleanup-attempt'){return Response.json(await repo.cleanupAttempt(url.searchParams.get('id')!,url.searchParams.get('mode')!));}
 if(url.pathname==='/fixture/inspection')return Response.json(await repo.getHistoryInspection(url.searchParams.get('id')!));
 if(url.pathname==='/fixture/native-possible')return Response.json(await repo.nativePossible(url.searchParams.get('id')!));
 if(url.pathname==='/fixture/pause-native')return Response.json(await repo.pauseNative(url.searchParams.get('id')!));
 if(url.pathname==='/fixture/native-stopped'){await env.INTEGRATOR.getByName(url.searchParams.get('id')!).knownStopped();return new Response('ok');}
 if(url.pathname==='/fixture/native-state')return Response.json(await env.INTEGRATOR.getByName(url.searchParams.get('id')!).snapshot());
 if(url.pathname==='/fixture/dispatch')return Response.json(lastDispatch);
 if(url.pathname==='/fixture/calls')return Response.json(calls);
 if(url.pathname==='/fixture/move'){await repo.moveAcceptedHead();return Response.json(await repo.getState());}
 if(url.pathname==='/fixture/status'){providerStatus=url.searchParams.get('value')??'unavailable';return new Response('ok');}
 if(url.pathname==='/fixture/expire'){await repo.expire(url.searchParams.get('id')!);return new Response('ok');}
 if(url.pathname==='/fixture/verified'){await repo.verified(url.searchParams.get('id')!);return new Response('ok');}
 if(url.pathname==='/fixture/legacy'){const id=url.searchParams.get('id')!;await account.legacy(id);await repo.clearInspection(id);return new Response('ok');}
 if(url.pathname==='/fixture/revoke'){await account.revokeApiToken(url.searchParams.get('id')!);return new Response('ok');}
 if(url.pathname==='/fixture/seal'){await account.beginAccountDeletion();return new Response('ok');}
 if(url.pathname==='/fixture/restore-owner'){await repo.addMember('owner','owner');return new Response('ok');}
 if(url.pathname==='/fixture/remove-owner'){await repo.addMember('owner','member');return new Response('ok');}
 const forbidden=(name:string)=>()=>{calls.push(name);throw Error('Synthetic unavailable provider');};
 return worker.fetch(request,{...env,API_LIMITER:{limit:async()=>({success:true})},CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:'https://fixture.example',IMPORT_HISTORY_WORKFLOW:{createBatch:async(batch:Array<{id:string}>)=>{calls.push(`create:${batch[0]!.id}`);lastDispatch=batch[0];throw Error('Synthetic lost delivery acknowledgment');},get:async(id:string)=>({status:async()=>{calls.push(`status:${id}`);if(providerStatus==='unavailable')throw Error('Synthetic missing handle');return {status:providerStatus};},terminate:async()=>{calls.push(`terminate:${id}`);providerStatus='terminated';}})},ARTIFACTS:{get:forbidden('artifact'),delete:async()=>{calls.push('Artifact.delete');return false;}},INTEGRATOR:{getByName:forbidden('VM')},EVIDENCE_BUCKET:{get:forbidden('R2.get'),delete:forbidden('R2.delete'),list:async()=>({objects:[],truncated:false})}} as unknown as Env,ctx);
}};
