import {RepositoryController} from '../../src/server/durable-object';
import type {Env} from '../../src/server/env';
import {RepositoryConnections} from '../../src/server/connections';
export class ServiceLifecycleFixture extends RepositoryController {
 constructor(ctx:DurableObjectState,env:Env){
  super(ctx,{...env,REPOSITORY_CONTROLLER:{idFromName:(name:string)=>name,get:()=>({accountLifecycle:async()=>{
   if(await ctx.storage.get('race'))ctx.storage.sql.exec("UPDATE members SET role='member' WHERE user_id='owner'");
   if(await ctx.storage.get('outage'))throw new Error('Synthetic account outage');
   return await ctx.storage.get<string>('lifecycle')??'active';
  }})}} as unknown as Env);
 }
 override async fetch(request:Request) {
  const path=new URL(request.url).pathname;
  if(path==='/setup'){
   await this.initialize({projectId:'fixture',projectName:'Synthetic service lifecycle fixture',canonicalRepoName:'fixture',head:'a'.repeat(40),verificationPolicy:{},ownerId:'owner'});
   await this.addMember('owner','owner');
   const ledger=new RepositoryConnections(this.ctx.storage,'fixture');
   const service=ledger.create('Generic reviewer',['read-candidate','comment']);
   ledger.freeze({repositoryId:'fixture',candidateId:'candidate',commit:'a'.repeat(40),tree:'b'.repeat(40),policy:{version:1,mode:'augment',checks:[]}});
   await this.ctx.storage.put('service',service.metadata.id);
   return Response.json(service);
  }
  if(path==='/delete'){await this.beginRepositoryDeletion();return new Response('ok');}
  if(path==='/demote'){await this.addMember('owner','member');return new Response('ok');}
  if(path==='/account-deleting'){await this.ctx.storage.put('lifecycle','deleting');return new Response('ok');}
  if(path==='/outage'){await this.ctx.storage.put('outage',true);return new Response('ok');}
  if(path==='/restore'){await this.ctx.storage.delete('lifecycle');await this.ctx.storage.delete('race');await this.ctx.storage.delete('outage');await this.addMember('owner','owner');return new Response('ok');}
  if(path==='/race'){await this.ctx.storage.put('race',true);return new Response('ok');}
  const id=await this.ctx.storage.get<string>('service');
  if(!id)return new Response('missing',{status:404});
  if(path==='/callback'){const result=await this.acceptIntegrationCallback({repositoryId:'fixture',serviceId:id,eventId:'stable-event',timestamp:1,report:{type:'comment',candidateId:'candidate',commit:'a'.repeat(40),body:'Synthetic external review'}});return Response.json(result,{status:result.kind==='rejected'?409:200});}
  if(path==='/counts')return Response.json({receipts:this.ctx.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM connection_receipts').toArray()[0]!.n,comments:this.ctx.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM comments').toArray()[0]!.n});
  return Response.json(path==='/config'?await this.connectionSigningConfig(id):await this.serviceCandidateSnapshot(id,'candidate','a'.repeat(40),crypto.randomUUID()));
 }
}
export default {fetch(request:Request,env:{TEST:DurableObjectNamespace<ServiceLifecycleFixture>}){return env.TEST.getByName(new URL(request.url).searchParams.get('case')??'normal').fetch(request);}};
