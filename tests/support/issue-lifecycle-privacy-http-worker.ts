import worker from '../../src/server/worker';
import {IssueReadPrivacyFixture} from './issue-read-privacy-http-worker';
import type {CommentRow,CommentPage} from '../../src/server/durable-object';
import {accountKeyFor,accountOf} from '../../src/server/projects';
import type {Env} from '../../src/server/env';

type DeletionRace={mode:'membership'|'token'|'account';userId:string;tokenId?:string};
const projectId='p123456789abc';
export class IssueLifecyclePrivacyFixture extends IssueReadPrivacyFixture{
 async lifecycleSeed(){
  const late=await super.seed();for(const user of ['owner-membership-race','owner-token-race','owner-account-race'])await this.addMember(user,'owner');
  const issues=[late];for(let index=0;index<4;index++){const issue=await this.createIssue({title:'Private deletion secret '+index,body:'Private deletion body secret',author:'Owner'});await this.addComment({subject:`issue:${issue.number}`,author:'Owner',body:'Private deletion comment secret'});issues.push(issue.number);}
  return await Promise.all(issues.map(async number=>{const issue=await this.getIssue(number);return{number,revision:issue!.stateRevision!};}));
 }
 async armLateComments(number:number){await this.ctx.storage.put('fixture_comments_late_deletion',number);}
 async armLateRead(number:number){await this.ctx.storage.put('fixture_issue_late_deletion',number);}
 async armDeletionRace(race:DeletionRace){await this.ctx.storage.put('fixture_issue_deletion_race',race);}
 override async listComments(subject:string):Promise<CommentRow[]>{
  const comments=await super.listComments(subject),number=await this.ctx.storage.get<number>('fixture_issue_late_deletion');
  if(number!==undefined&&subject===`issue:${number}`){
   await this.ctx.storage.delete('fixture_issue_late_deletion');const issue=await this.getIssue(number);
   const result=await this.deleteIssueMutation(number,{expectedRevision:issue!.stateRevision!,requestId:crypto.randomUUID(),confirmed:true},{userId:'owner',displayName:'Fixture owner',viaToken:false},{sessionExpiresAt:Date.now()+300000});
   if(!result.ok)throw Error('Synthetic late deletion failed: '+result.error);
  }
  return comments;
 }
 override async listMemberCommentsPage(userId:string,subject:string,cursor?:string):Promise<CommentPage>{
  const page=await super.listMemberCommentsPage(userId,subject,cursor),number=await this.ctx.storage.get<number>('fixture_comments_late_deletion');
  if(number!==undefined&&subject===`issue:${number}`){
   await this.ctx.storage.delete('fixture_comments_late_deletion');const issue=await this.getIssue(number);
   const result=await this.deleteIssueMutation(number,{expectedRevision:issue!.stateRevision!,requestId:crypto.randomUUID(),confirmed:true},{userId:'owner',displayName:'Fixture owner',viaToken:false},{sessionExpiresAt:Date.now()+300000});
   if(!result.ok)throw Error('Synthetic late comments deletion failed: '+result.error);
  }
  return page;
 }
 protected override async beforeIssueDeletionCommit(){
  const race=await this.ctx.storage.get<DeletionRace>('fixture_issue_deletion_race');if(!race)return;await this.ctx.storage.delete('fixture_issue_deletion_race');
  if(race.mode==='membership')this.ctx.storage.sql.exec('DELETE FROM members WHERE user_id=?',race.userId);
  else{const account=accountOf(this.env,await accountKeyFor(race.userId));if(race.mode==='token')await account.revokeApiToken(race.tokenId!);else await account.beginAccountDeletion();}
 }
 async rawAudit(number:number){
  const markers=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='issue_tombstones'").toArray().length?this.ctx.storage.sql.exec<{count:number}>('SELECT COUNT(*) AS count FROM issue_tombstones WHERE issue_number=?',number).toArray()[0]!.count:0;
  return{retained:this.ctx.storage.sql.exec<{count:number}>('SELECT COUNT(*) AS count FROM issues WHERE number=?',number).toArray()[0]!.count,markers,active:await this.getIssue(number)!==null};
 }
}
export default{
 async fetch(request:Request,env:Env&{FIXTURE_ISSUER:string},ctx:ExecutionContext){
  const url=new URL(request.url),repository=env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`) as unknown as IssueLifecyclePrivacyFixture;
  if(url.pathname==='/fixture/seed'){
   const issues=await repository.lifecycleSeed(),tokens:Record<string,{secret:string;id:string}>={};
   for(const [name,user,scope,character] of [['read','owner','read','r'],['owner','owner-token-race','full','t']] as const){const key=await accountKeyFor(user),secret=`fgt_${key}_${character.repeat(32)}`,saved=await accountOf(env,key).createApiToken(user,'Synthetic deletion '+name,secret,{scope,repo:projectId});tokens[name]={secret,id:saved.id};}
   return Response.json({issues,tokens});
  }
  if(url.pathname==='/fixture/late-comments'){await repository.armLateComments(Number(url.searchParams.get('number')));return Response.json({armed:true});}
  if(url.pathname==='/fixture/late'){await repository.armLateRead(Number(url.searchParams.get('number')));return Response.json({armed:true});}
  if(url.pathname==='/fixture/deletion-race'){
   const mode=url.searchParams.get('mode');if(mode!=='membership'&&mode!=='token'&&mode!=='account')return Response.json({error:'Invalid fixture race'},{status:400});
   await repository.armDeletionRace({mode,userId:url.searchParams.get('user')!,...(url.searchParams.has('token')?{tokenId:url.searchParams.get('token')!}:{})});return Response.json({armed:true});
  }
  if(url.pathname==='/fixture/audit')return Response.json(await repository.rawAudit(Number(url.searchParams.get('number'))));
  return worker.fetch(request,{...env,CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:'https://fixture.example',API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})}} as unknown as Env,ctx);
 }
};
