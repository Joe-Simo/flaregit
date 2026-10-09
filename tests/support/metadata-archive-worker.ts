import {accountOf,accountKeyFor} from "../../src/server/projects";
import {RepositoryDiscussions} from "../../src/server/repository-discussions";
import {MAX_METADATA_ARCHIVE_BYTES} from "../../src/server/metadata-archive";
import {readRequestJson,RequestBodyError} from "../../src/server/request-body";
import {DurableWikiStore} from '../../src/server/wiki-store';
import {PlanningStore} from '../../src/server/planning-store';
import {PublicationFixture} from './sqlite-publication-worker';
export class MetadataArchiveFixture extends PublicationFixture{
 private lifecycleDelay=0;
 async delayLifecycle(ms:number){this.lifecycleDelay=ms;}
 override async accountLifecycle(){if(this.lifecycleDelay)await new Promise(resolve=>setTimeout(resolve,this.lifecycleDelay));return super.accountLifecycle();}
 async expiredRestore(value:{archive:unknown;requestId:string;sha256:string}){
  const account=accountOf(this.env,await accountKeyFor('owner')) as unknown as MetadataArchiveFixture;
  await account.delayLifecycle(100);
  try{return await this.metadataArchiveRestore('owner',value.archive,value.requestId,value.sha256,Date.now()+50);}finally{await account.delayLifecycle(0);}
 }

 data(){this.ctx.storage.sql.exec("INSERT INTO issues(title,body,state,author,created_at,updated_at) VALUES('Original issue','Fix', 'open','owner','2026-10-08','2026-10-08'); INSERT INTO comments(subject,author,body,created_at) VALUES('issue:1','owner','Original conversation','2026-10-08')");}
 content(){new RepositoryDiscussions(this.ctx.storage,false).create({userId:'owner',accountKey:'owner',displayName:'Owner'},{category:'general',title:'Original discussion',body:'Repository conversation',confirmed:true,idempotencyKey:'discussion-original'});new DurableWikiStore(this.ctx.storage).save('readme',{author:'owner',body:'Original wiki',expectedRevision:null});new PlanningStore(this.ctx.storage).mutate({operation:'addItem',expectedVersion:0,issueNumber:1},true);}
 rawCount(){return this.ctx.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM issues').toArray()[0]!.n;}
}
export default{async fetch(request:Request,env:{TEST:DurableObjectNamespace<MetadataArchiveFixture>}){const url=new URL(request.url),stub=env.TEST.getByName(url.searchParams.get('name')??'source'),actor=url.searchParams.get('actor')??'owner';try{
 if(url.pathname==='/seed'){await stub.seed(await request.json() as Parameters<typeof stub.seed>[0],'holder');await stub.addMember('owner','owner');await stub.addMember('member','member');return Response.json({ok:true});}
 if(url.pathname==='/data'){await stub.data();return Response.json({ok:true});}
 if(url.pathname==='/content'){await stub.content();return Response.json({ok:true});}
 if(url.pathname==='/export'){const credential={viaToken:false,sessionExpiresAt:Date.now()+60000,includeHistory:actor==='owner'},result=await stub.metadataArchiveExport(actor,credential);await stub.metadataArchiveRelease(actor,credential,result.releaseProof);return Response.json({archive:result.archive,sha256:result.sha256});}
 if(url.pathname==='/expired-restore')return Response.json(await stub.expiredRestore(await request.json() as {archive:unknown;requestId:string;sha256:string}));
 if(url.pathname==='/restore'){const value=await readRequestJson<{archive:unknown;requestId:string;sha256:string}>(request,MAX_METADATA_ARCHIVE_BYTES+1024);return Response.json(await stub.metadataArchiveRestore(actor,value.archive,value.requestId,value.sha256,Date.now()+60000));}
 if(url.pathname==='/issue')return Response.json(await stub.getIssue(1));
 if(url.pathname==='/history'){const credential={viaToken:false,sessionExpiresAt:Date.now()+60000,includeHistory:actor==='owner'},result=await stub.metadataArchiveHistory(actor,credential);await stub.metadataArchiveRelease(actor,credential,result.releaseProof);return Response.json(result.records);}
 if(url.pathname==='/count')return Response.json({count:await stub.rawCount()});
 return new Response('Missing',{status:404});
 }catch(error){return Response.json({error:String(error)},{status:error instanceof RequestBodyError?413:409});}}};
