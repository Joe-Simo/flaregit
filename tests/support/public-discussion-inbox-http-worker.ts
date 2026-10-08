import worker from '../../src/server/worker';
import {RepositoryController} from '../../src/server/durable-object';
import {accountKeyFor,accountOf} from '../../src/server/projects';
import type {Env} from '../../src/server/env';

const projectId='p123456789abc';
export class PublicDiscussionInboxFixture extends RepositoryController{
 async bootstrap(){await this.initialize({projectId,projectName:'Current public repository',canonicalRepoName:'synthetic-only',head:'a'.repeat(40),verificationPolicy:{kind:'git-integrity'},ownerId:'discussion-owner'});await this.prepare(true);}
 async prepare(enabled:boolean){const actor={userId:'discussion-owner',accountKey:await accountKeyFor('discussion-owner'),displayName:'Maintainer'};await this.setRepositoryVisibility('public',true,actor.userId);await this.configurePublicCommunity({enabled,scopes:enabled?['discussions']:[]},true,actor);}
 async retryNotification(topic:string,entry:string){this.ctx.storage.sql.exec('INSERT OR IGNORE INTO repository_public_discussion_notifications(event_id,actor_id,topic_id,entry_id) VALUES(?,?,?,?)',entry,'discussion-outsider',topic,entry);await this.alarm();}
 async drain(){await this.alarm();}
 async privateVisibility(){await this.setRepositoryVisibility('private',false,'discussion-owner');}
 async poisonStoredPublic(){this.ctx.storage.sql.exec("UPDATE inbox SET project_name='Private former repository name',title='Private historical notification secret' WHERE type LIKE 'discussion.reply.public.%'");}
 async race(){await this.ctx.storage.put('fixture_notification_race',true);}
 override async publicDiscussionNotification(actorId:string,topicId:string,entryId:string){
  const result=await super.publicDiscussionNotification(actorId,topicId,entryId);
  if(result&&await this.ctx.storage.get<boolean>('fixture_notification_race')){await this.ctx.storage.delete('fixture_notification_race');await this.privateVisibility();}
  return result;
 }
}
export default{
 async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const url=new URL(request.url),project=env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`) as unknown as PublicDiscussionInboxFixture;
  if(url.pathname==='/fixture/bootstrap'){
   await project.bootstrap();const tokens:Record<string,string>={};
   for(const [userId,name,secret] of [['discussion-owner','Maintainer','o'],['discussion-outsider','Subscriber','s'],['discussion-replier','Reply author','r']] as const){
    const key=await accountKeyFor(userId),account=accountOf(env,key);await account.setProfile({handle:userId,displayName:name,bio:'',joinedAt:new Date().toISOString()});const token=`fgt_${key}_${secret.repeat(32)}`;await account.createApiToken(userId,'Synthetic inbox fixture',token,{scope:'full'});tokens[userId]=token;
   }
   return Response.json({tokens,outsiderRole:await project.roleOf('discussion-outsider')});
  }
  if(url.pathname==='/fixture/retry-event'){await project.retryNotification(url.searchParams.get('topic')!,url.searchParams.get('entry')!);return Response.json({retried:true});}
  if(url.pathname==='/fixture/drain'){await project.drain();return Response.json({drained:true});}
  if(url.pathname==='/fixture/poison'){
   const account=accountOf(env,await accountKeyFor('discussion-outsider'));await account.addInbox({projectId,projectName:'Private former repository name',kind:'activity',type:'work.changed',title:'Private same-project secret'});
   await (env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor('discussion-outsider')}`) as unknown as PublicDiscussionInboxFixture).poisonStoredPublic();return Response.json({seeded:true});
  }
  if(url.pathname==='/fixture/wrong-topic'){
   const account=accountOf(env,await accountKeyFor('discussion-outsider'));await account.addInbox({projectId,projectName:'Private former repository name',kind:'activity',type:`discussion.reply.public.${url.searchParams.get('topic')}.${url.searchParams.get('entry')}`,title:'Wrong topic secret'});return Response.json({seeded:true});
  }
  if(url.pathname==='/fixture/scope'){await project.prepare(url.searchParams.get('enabled')!=='false');return Response.json({changed:true});}
  if(url.pathname==='/fixture/private'){await project.privateVisibility();return Response.json({changed:true});}
  if(url.pathname==='/fixture/race'){await project.race();return Response.json({armed:true});}
  return worker.fetch(request,{...env,API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})}} as unknown as Env,ctx);
 }
};
