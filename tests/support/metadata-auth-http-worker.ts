import {MetadataArchives} from "../../src/server/metadata-archive";
import {RepositoryDiscussions} from "../../src/server/repository-discussions";
import worker from '../../src/server/worker';
import {ConversationMigrationFixture} from './conversation-migration-worker';
import {accountOf,accountKeyFor} from '../../src/server/projects';
import type {Env} from '../../src/server/env';
export class MetadataAuthFixture extends ConversationMigrationFixture{
 private pauseArchive=false;private archivePaused=false;private archiveResume:(()=>void)|null=null;private archiveReportId="";private archivePauseKind:"export"|"history"="export";
 async archivePrivacySeed(){await this.addMember("reader","member");const key=crypto.randomUUID();new MetadataArchives(this.ctx.storage);const discussions=new RepositoryDiscussions(this.ctx.storage,false),actor={userId:"private-archive-author",accountKey:"a".repeat(12),displayName:"Private Author"},topic=discussions.create(actor,{category:"question",title:"Private archive topic",body:"Private archive body before suppression",confirmed:true,idempotencyKey:`archive-http-topic-${key}`});discussions.create(actor,{body:"Private archive descendant before suppression",confirmed:true,idempotencyKey:`archive-http-reply-${key}`},topic.id);this.ctx.storage.sql.exec('INSERT INTO metadata_archive_history(table_name,source_id,doc) VALUES(?,?,?)','repository_private_discussion_entries',key,JSON.stringify({id:topic.id,topic_id:topic.id,author_id:actor.userId,doc:JSON.stringify(topic)}));this.archiveReportId=discussions.moderation().report(topic.id,"reporter",{reason:"spam",note:"Reporter private context"}).id;return {id:topic.id};}
 async archivePause(kind:"export"|"history"="export"){this.archivePauseKind=kind;this.pauseArchive=true;this.archivePaused=false;}
 async archivePauseState(){return this.archivePaused;}
 async archiveSuppressAndResume(){try{new RepositoryDiscussions(this.ctx.storage,false).moderation().resolve(this.archiveReportId,"moderator",true,{action:"hide",reason:"Hide during post-export authorization",expectedVersion:1});}finally{this.archiveResume?.();this.archiveResume=null;this.archivePaused=false;}}
 override async metadataArchiveHistory(...args:Parameters<ConversationMigrationFixture['metadataArchiveHistory']>){const result=await super.metadataArchiveHistory(...args);if(this.pauseArchive&&this.archivePauseKind==="history"){this.pauseArchive=false;this.archivePaused=true;await new Promise<void>(resolve=>{this.archiveResume=resolve;});}return result;}
 override async metadataArchiveExport(...args:Parameters<ConversationMigrationFixture['metadataArchiveExport']>){const result=await super.metadataArchiveExport(...args);if(this.pauseArchive&&this.archivePauseKind==="export"){this.pauseArchive=false;this.archivePaused=true;await new Promise<void>(resolve=>{this.archiveResume=resolve;});}return result;}
 private roleReads=0;
 override async roleOf(userId:string){this.roleReads++;return super.roleOf(userId);}
 async roles(){return this.roleReads;}
 async withdrawOwner(){this.ctx.storage.sql.exec("UPDATE members SET role='member' WHERE user_id='owner'");}
 async restoreOwner(){await this.addMember('owner','owner');}
 async testToken(){const account=accountOf(this.env,await accountKeyFor('owner')),secret=`fgt_${await accountKeyFor('owner')}_${'a'.repeat(40)}`,saved=await account.createApiToken('owner','Fixture',secret,{scope:'full'});return{secret,id:saved.id};}
 async revokeToken(id:string){return accountOf(this.env,await accountKeyFor('owner')).revokeApiToken(id);}
}
interface FixtureEnv extends Env{FIXTURE_ISSUER:string}
export default{async fetch(request:Request,env:FixtureEnv,ctx:ExecutionContext){const url=new URL(request.url),repository=env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as MetadataAuthFixture;
 if(url.pathname==='/fixture/archive-privacy-seed')return Response.json(await repository.archivePrivacySeed());
 if(url.pathname==='/fixture/archive-pause'){await repository.archivePause(url.searchParams.get("kind")==="history"?"history":"export");return Response.json({ok:true});}
 if(url.pathname==='/fixture/archive-paused')return Response.json({paused:await repository.archivePauseState()});
 if(url.pathname==='/fixture/archive-hide-resume'){await repository.archiveSuppressAndResume();return Response.json({ok:true});}
 if(url.pathname==='/fixture/seed')return repository.fetch(new Request('https://test/seed'));
 if(url.pathname==='/fixture/roles')return Response.json({count:await repository.roles()});
 if(url.pathname==='/fixture/withdraw-owner'){await repository.withdrawOwner();return Response.json({ok:true});}
 if(url.pathname==='/fixture/restore-owner'){await repository.restoreOwner();return Response.json({ok:true});}
 if(url.pathname==='/fixture/token')return Response.json(await repository.testToken());
 if(url.pathname==='/fixture/revoke'){await repository.revokeToken(url.searchParams.get('id')!);return Response.json({ok:true});}
 return worker.fetch(request,{...env,API_LIMITER:{limit:async()=>({success:true})},CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:'https://fixture.example'} as unknown as Env,ctx);
}};
