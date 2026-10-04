import {RepositoryController} from '../../src/server/durable-object';
import {accountKeyFor,accountOf,projectOf} from '../../src/server/projects';
import type {Env} from '../../src/server/env';
import type {RepositoryCreationRequest} from '../../src/server/repository-creation-request';
export class RepositoryInitializationFixture extends RepositoryController{
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);env.INTEGRATOR={getByName:()=>({lifetimeStatus:async()=>({state:'stopped',sealed:true})})} as unknown as Env['INTEGRATOR'];}
 async fault(on:boolean){this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS repository_initialization_receipts(event_id TEXT PRIMARY KEY,payload TEXT NOT NULL)");if(on)this.ctx.storage.sql.exec("CREATE TRIGGER reject_initialized_receipt BEFORE INSERT ON repository_initialization_receipts BEGIN SELECT RAISE(ABORT,'synthetic initialized receipt failure'); END");else this.ctx.storage.sql.exec('DROP TRIGGER IF EXISTS reject_initialized_receipt');}
 async raw(){return{projects:this.ctx.storage.sql.exec('SELECT id FROM project').toArray().length,members:this.ctx.storage.sql.exec('SELECT user_id FROM members').toArray().length,receipts:this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='repository_initialization_receipts'").toArray().length?this.ctx.storage.sql.exec('SELECT event_id FROM repository_initialization_receipts').toArray().length:0};}
}
export default{async fetch(request:Request,env:Env){const url=new URL(request.url),actor='owner',account=accountOf(env,await accountKeyFor(actor)),credential={viaToken:false,sessionExpiresAt:Date.now()+(url.searchParams.get('expired')==='true'?-1000:60000)};try{
 if(url.pathname==='/prepare')return Response.json(await account.prepareRepositoryInitialization(await request.json() as RepositoryCreationRequest,actor,credential));
 const event=url.searchParams.get('event')!,record=await account.repositoryInitializationRecord(event,actor,{viaToken:false,sessionExpiresAt:Date.now()+60000});if(!record)throw Error('Saved initialization unavailable');const project=projectOf(env,record.scope.projectId) as unknown as RepositoryInitializationFixture;
 if(url.pathname==='/facts'){await account.beginRepositoryInitializationCreate(event,actor,credential);await account.recordRepositoryCreated(event,{id:'provider-init',name:record.scope.canonicalRepoName,remote:`https://${'a'.repeat(32)}.artifacts.cloudflare.net/repo`},'synthetic-canonical-token');await account.beginRepositoryInitializationNative(event,`readme-${event}`,actor,credential);const commit={head:'a'.repeat(40),tree:'b'.repeat(40),defaultBranch:record.scope.defaultBranch};await account.recordRepositoryInitializationCommit(event,commit);await account.markRepositoryInitializationPushPossible(event,actor,credential);await account.confirmRepositoryInitializationPublished(event,commit);await account.confirmRepositoryInitializationStopped(event);await account.confirmRepositoryInitializationCredentialRevoked(event);return Response.json(await account.completeRepositoryInitialization(event,actor,credential));}
 if(url.pathname==='/fault'){await project.fault(url.searchParams.get('on')==='true');return Response.json({armed:true});}
 if(url.pathname==='/bootstrap')return Response.json(await project.initializeRepositoryReceipt(record,credential));
 if(url.pathname==='/raw')return Response.json(await project.raw());
 if(url.pathname==='/register'){await account.registerInitializedRepository(event,actor,credential);return Response.json(await account.listProjects());}
 return new Response('Missing fixture',{status:404});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Fixture failure'},{status:409});}}};
