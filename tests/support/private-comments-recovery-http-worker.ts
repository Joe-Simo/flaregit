import {OrganizationAccessLedger} from '../../src/server/organization-access';
import worker from "../../src/server/worker";
import {RepositoryController} from "../../src/server/durable-object";
import {accountKeyFor} from "../../src/server/projects";
import type {Env} from "../../src/server/env";
const projectId="p123456789abc";const providerCalls:string[]=[];
export class CommentRecoveryFixture extends RepositoryController{
 async arm(hook:"profile"|"lifecycle",effect:"revoke-member"|"seal"|"delete"|"revoke-token",after:number){await this.ctx.storage.put({hook,effect,after,calls:0});}
 private async fixtureHook(hook:string){if(await this.ctx.storage.get("hook")!==hook)return;const n=Number(await this.ctx.storage.get("calls")??0)+1;await this.ctx.storage.put("calls",n);if(n!==await this.ctx.storage.get("after"))return;await this.ctx.storage.delete("hook");const repo=this.env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`) as unknown as CommentRecoveryFixture;const effect=await this.ctx.storage.get("effect");if(effect==="revoke-member")await repo.removeMember("member");else if(effect==="delete")await repo.beginRepositoryDeletion();else if(effect==="revoke-token"){const id=await this.ctx.storage.get<string>("tokenId");if(id)await this.revokeApiToken(id);}else await this.beginAccountDeletion();}
 override async getProfile(){await this.fixtureHook("profile");return super.getProfile();}
 override async accountLifecycle(){await this.fixtureHook("lifecycle");return super.accountLifecycle();}
 createMentionOrganization(){const ledger=new OrganizationAccessLedger(this.ctx.storage),doc=ledger.createOrganization('mention-org','Synthetic mentions','owner');return ledger.grantRepository(doc.id,'owner',doc.revision,projectId,{kind:'user',id:'other'},'read');}
 revokeMentionOrganization(){const ledger=new OrganizationAccessLedger(this.ctx.storage),doc=ledger.snapshot('mention-org')!;return ledger.revokeRepositoryGrant(doc.id,'owner',doc.revision,projectId,{kind:'user',id:'other'});}
 regrantOwnerIdenticalTimestamp(){const row=this.ctx.storage.sql.exec<{role:string;label:string|null;added_at:string}>("SELECT role,label,added_at FROM members WHERE user_id='owner'").toArray()[0]!;this.ctx.storage.transactionSync(()=>{this.ctx.storage.sql.exec("DELETE FROM members WHERE user_id='owner'");this.ctx.storage.sql.exec('INSERT INTO members(user_id,role,label,added_at) VALUES(?,?,?,?)','owner',row.role,row.label,row.added_at);});}
 removeDirectOther(){this.ctx.storage.sql.exec("DELETE FROM members WHERE user_id='other'");}
 async flushThreadNotifications(){await (this as unknown as {deliverThreadNotifications():Promise<void>}).deliverThreadNotifications();}
 async loseInboxAcknowledgement(){await this.ctx.storage.put('lose-inbox',true);}
 override async addInbox(item:Parameters<RepositoryController['addInbox']>[0]){await super.addInbox(item);if(await this.ctx.storage.get('lose-inbox')){await this.ctx.storage.delete('lose-inbox');throw Error('Synthetic lost inbox acknowledgement');}}
 async keepToken(id:string){await this.ctx.storage.put("tokenId",id);}
 restoreAccount(){this.ctx.storage.sql.exec("UPDATE account_lifecycle SET status='active' WHERE id=1");}
 async seed(){await this.initialize({projectId,projectName:"Synthetic private comments",canonicalRepoName:"fixture",head:"a".repeat(40),verificationPolicy:{},ownerId:"owner"});await this.addMember("member","member");await this.addMember("other","member");for(const id of ["change-one","change-two"])await this.createTask({id,goal:"Synthetic comment topic",contributor:{id:"member",name:"Fixture",type:"human"},baseCommit:"b".repeat(40),currentCommit:"a".repeat(40),allowedScope:[],status:"working",requirements:[],workspace:{repoName:"fixture",remote:"https://fixture.invalid",branch:`task/${id}`},checkpoints:[],createdAt:"2026-10-03",updatedAt:"2026-10-03"},"member");for(let n=0;n<600;n++)this.ctx.storage.sql.exec('INSERT INTO comments (subject,author,body,created_at) VALUES(?,?,?,?)',"change:change-one","Synthetic fixture",`seed-${n+1}`,"2026-10-03");}
 commentsSnapshot(){return this.ctx.storage.sql.exec('SELECT * FROM comments ORDER BY id').toArray();}
 removeComment(id:number){this.ctx.storage.sql.exec("DELETE FROM comments WHERE id=?",id);}
}
type FixtureEnv=Omit<Env,"REPOSITORY_CONTROLLER">&{REPOSITORY_CONTROLLER:DurableObjectNamespace<CommentRecoveryFixture>;FIXTURE_ISSUER:string};
export default{async fetch(request:Request,env:FixtureEnv,ctx:ExecutionContext){const url=new URL(request.url),repo=env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`),memberAccount=env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor("member")}`);
 if(url.pathname==="/fixture/bootstrap"){await repo.seed();const tokens:Record<string,string>={};for(const actor of ["owner","member","other"]){const key=await accountKeyFor(actor),account=env.REPOSITORY_CONTROLLER.getByName(`account:${key}`);await account.setProfile({handle:actor,displayName:`Original ${actor}`,bio:"",joinedAt:"2026-10-03"});const token=`fgt_${key}_${actor==="member"?"m":"o"}`+"x".repeat(31);const result=await account.createApiToken(actor,"synthetic",token,{scope:"full"});await account.keepToken(result.id);tokens[actor]=token;}for(const actor of ['owner','member','other']){const registry=env.REPOSITORY_CONTROLLER.getByName('global'),key=await accountKeyFor(actor);await registry.claimHandle(actor,key);await registry.commitHandle(actor,key);}return Response.json(tokens);}
 if(url.pathname==='/fixture/regrant-identical-timestamp'){await repo.regrantOwnerIdenticalTimestamp();return new Response('ok');}
 if(url.pathname==='/fixture/change-mention-profile'){const key=await accountKeyFor('owner'),account=env.REPOSITORY_CONTROLLER.getByName(`account:${key}`),registry=env.REPOSITORY_CONTROLLER.getByName('global');await registry.claimHandle('renamed-owner',key);await account.setProfile({handle:'renamed-owner',displayName:'Changed owner',bio:'Updated private biography',joinedAt:'2026-10-03'});await registry.commitHandle('renamed-owner',key);return new Response('ok');}
 if(url.pathname==='/fixture/inherited-mention'){const doc=await env.REPOSITORY_CONTROLLER.getByName('global').createMentionOrganization();await repo.synchronizeOrganization(doc);await repo.removeDirectOther();return new Response('ok');}
 if(url.pathname==='/fixture/revoke-inherited-mention'){await env.REPOSITORY_CONTROLLER.getByName('global').revokeMentionOrganization();return new Response('ok');}
 if(url.pathname==='/fixture/flush-thread'){await repo.flushThreadNotifications();return new Response('ok');}
 if(url.pathname==='/fixture/lose-inbox'){await env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor('owner')}`).loseInboxAcknowledgement();return new Response('ok');}
 if(url.pathname==="/fixture/snapshot")return Response.json(await repo.commentsSnapshot());
 if(url.pathname==="/fixture/provider-calls")return Response.json(providerCalls);
 if(url.pathname==="/fixture/rename"){await memberAccount.setProfile({handle:"member",displayName:"Changed member",bio:"",joinedAt:"2026-10-03"});return new Response("ok");}
 if(url.pathname==="/fixture/remove"){await repo.removeComment(Number(url.searchParams.get("id")));return new Response("ok");}
 if(url.pathname==="/fixture/restore"){await repo.addMember("member","member");await memberAccount.restoreAccount();return new Response("ok");}
 if(url.pathname==="/fixture/arm"){await memberAccount.arm(url.searchParams.get("hook") as "profile"|"lifecycle",url.searchParams.get("effect") as "revoke-member"|"seal"|"delete"|"revoke-token",Number(url.searchParams.get("after")??1));return new Response("ok");}
 const deny=(name:string)=>()=>{providerCalls.push(name);throw new Error("Private comment unexpectedly invoked provider");};
 return worker.fetch(request,{...env,API_LIMITER:{limit:async()=>({success:true})},CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:"https://fixture.example",ARTIFACTS:{get:deny("artifact")},INTEGRATOR:{getByName:deny("VM")},EVIDENCE_BUCKET:{put:deny("R2.put"),get:deny("R2.get"),delete:deny("R2.delete")}} as unknown as Env,ctx);
}};
