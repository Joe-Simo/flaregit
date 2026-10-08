import worker from '../../src/server/worker';
import {RepositoryController,type CommentRow} from '../../src/server/durable-object';
import {accountOf,accountKeyFor} from '../../src/server/projects';
import type {Env} from '../../src/server/env';

type ReadRace={mode:'membership'|'token'|'account';userId:string;tokenId?:string};
const projectId='p123456789abc';
export class IssueReadPrivacyFixture extends RepositoryController{
 async seed(){
  await this.initialize({projectId,projectName:'Private issue fixture',canonicalRepoName:'synthetic-only',head:'a'.repeat(40),verificationPolicy:{kind:'git-integrity'},ownerId:'owner'});
  for(const user of ['member','pat-member','inactive-member'])await this.addMember(user,'member');
  const issue=await this.createIssue({title:'Private issue release-fence secret',body:'Private issue body release-fence secret',author:'Owner'});
  await this.addComment({subject:`issue:${issue.number}`,author:'Owner',body:'Private comment release-fence secret'});return issue.number;
 }
 async arm(race:ReadRace){await this.ctx.storage.put('fixture_issue_read_race',race);}
 override async listComments(subject:string):Promise<CommentRow[]>{
  const comments=await super.listComments(subject),race=await this.ctx.storage.get<ReadRace>('fixture_issue_read_race');
  if(race){
   await this.ctx.storage.delete('fixture_issue_read_race');
   if(race.mode==='membership')await this.removeMember(race.userId);
   else{const account=accountOf(this.env,await accountKeyFor(race.userId));if(race.mode==='token')await account.revokeApiToken(race.tokenId!);else await account.beginAccountDeletion();}
  }
  return comments;
 }
}
export default{
 async fetch(request:Request,env:Env&{FIXTURE_ISSUER:string},ctx:ExecutionContext){
  const url=new URL(request.url),project=env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`) as unknown as IssueReadPrivacyFixture;
  if(url.pathname==='/fixture/seed'){
   const issue=await project.seed(),key=await accountKeyFor('pat-member'),token=`fgt_${key}_${'p'.repeat(32)}`,account=accountOf(env,key);
   const created=await account.createApiToken('pat-member','Synthetic issue read token',token,{scope:'full',repo:projectId});return Response.json({issue,token,tokenId:created.id});
  }
  if(url.pathname==='/fixture/arm'){
   const mode=url.searchParams.get('mode');if(mode!=='membership'&&mode!=='token'&&mode!=='account')return Response.json({error:'Invalid synthetic race'},{status:400});
   await project.arm({mode,userId:url.searchParams.get('user')!,...(url.searchParams.has('token')?{tokenId:url.searchParams.get('token')!}:{})});return Response.json({armed:true});
  }
  return worker.fetch(request,{...env,CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:'https://fixture.example',API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})}} as unknown as Env,ctx);
 }
};
