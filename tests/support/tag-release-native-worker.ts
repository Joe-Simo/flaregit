import {RepositoryController} from '../../src/server/durable-object';
import type {ManagedEnvelope,ManagedBudget,ManagedAdmission} from '../../src/server/managed-spend-ledger';
import type {Env} from '../../src/server/env';
export class TagReleaseNativeFixture extends RepositoryController {
 private denyNative=false;private stopConfirmed=true;private revokeConfirmed=true;
 async fixtureDenyNative(){this.denyNative=true;}
 override async reserveManagedSpend(input:ManagedEnvelope,budget:ManagedBudget):Promise<ManagedAdmission>{if(this.denyNative){this.denyNative=false;return{allowed:false,reason:'account_budget'};}return super.reserveManagedSpend(input,budget);}

 protected override branchRepositoryProvider(){return{get:async()=>({info:async()=>({remote:`https://${'a'.repeat(32)}.artifacts.cloudflare.net/canonical`}),createToken:async(scope:'read'|'write',ttl:number)=>({plaintext:'synthetic-tag-key',scope,expiresAt:new Date(Date.now()+ttl*1000).toISOString()}),revokeToken:async()=>this.revokeConfirmed,[Symbol.dispose]:()=>{}})} as unknown as Env['ARTIFACTS'];}
 protected override branchNativeSandbox(nativeId:string){let sealed=false;return{exec:async(args:string[])=>{if(sealed)throw Error('sealed');const env=this.env as Env&{OWNED_NATIVE_URL:string};return await(await fetch(`${env.OWNED_NATIVE_URL}/exec`,{method:'POST',body:JSON.stringify({nativeId,command:args[2]})})).json();},seal:async()=>{sealed=true;},destroy:async()=>{},lifetimeStatus:async()=>({sealed:true,state:this.stopConfirmed?'stopped':'stopping'})} as unknown as ReturnType<Env['INTEGRATOR']['getByName']>;}
 override async fetch(request:Request){const url=new URL(request.url),actor={userId:url.searchParams.get('actor')??'owner',displayName:'Owned fixture',viaToken:false},expiry=Date.now()+60000;try{
 if(url.pathname==='/seed'){const input=await request.json() as{head:string;commit:string;tree:string};await this.initialize({projectId:'p123456789abc',projectName:'Owned native tag fixture',canonicalRepoName:'canonical',head:input.head,tree:input.tree,defaultBranch:'main',verificationPolicy:{},ownerId:'owner'});await this.addMember('reader','member');const state=await this.getState(),stamp=new Date().toISOString(),journalId=crypto.randomUUID(),candidateId='accepted-native-source';state.candidates[candidateId]={id:candidateId,attemptNumber:1,participatingTaskIds:[],participatingCommits:{},expectedAcceptedBase:input.head,frozenPolicyVersion:state.policyVersion,frozenVerificationPolicy:{},frozenRequirements:[],repairAttempts:[],candidateCommit:input.commit,status:'verified',createdAt:stamp,updatedAt:stamp};state.journal.push({id:journalId,candidateId,candidateCommit:input.commit,candidateTree:input.tree,expectedHead:input.head,newHead:input.commit,outputDigest:'native-owned-source',state:'PREPARED',timestamp:stamp});this.ctx.storage.sql.exec('UPDATE project SET doc=? WHERE id=1',JSON.stringify(state));await this.completePublish(journalId);return Response.json({journalId});}
 if(url.pathname==='/mode'){this.stopConfirmed=url.searchParams.get('stop')!=='false';this.revokeConfirmed=url.searchParams.get('revoke')!=='false';return Response.json({updated:true});}
 if(url.pathname==='/cleanup-tag')return Response.json(await this.cleanupTagOperation(url.searchParams.get('id')!,actor,undefined,expiry));
 if(url.pathname==='/deny-next'){const global=this.env.REPOSITORY_CONTROLLER.getByName('global') as unknown as TagReleaseNativeFixture;await global.fixtureDenyNative();return Response.json({armed:true});}
 if(url.pathname==='/resume'){const input=await request.json() as{id:string;resumeId:string};return Response.json(await this.resumePreparedTag(input.id,input.resumeId,actor,undefined,expiry));}
 if(url.pathname==='/tag')return Response.json(await this.createTag(await request.json() as Parameters<RepositoryController['createTag']>[0],actor,undefined,expiry));
 if(url.pathname==='/reconcile')return Response.json(await this.reconcileTag(url.searchParams.get('id')!,actor,undefined,expiry));
 if(url.pathname==='/tag-targets')return Response.json(await this.tagAcceptedTargets(actor,undefined,expiry));
 if(url.pathname==='/inventory')return Response.json(await this.tagInventory(actor,undefined,expiry));
 if(url.pathname==='/tag-record')return Response.json(await this.tagOperation(url.searchParams.get('id')!,actor,undefined,expiry));
 if(url.pathname==='/release-record')return Response.json(await this.release(url.searchParams.get('id')!,actor,undefined,expiry));
 if(url.pathname==='/tags')return Response.json(await this.tagOperations(actor,undefined,expiry));
 if(url.pathname==='/release')return Response.json(await this.createRelease(await request.json() as Parameters<RepositoryController['createRelease']>[0],actor,undefined,expiry));
 if(url.pathname==='/publish'){const input=await request.json() as{id:string;revision:number};return Response.json(await this.publishRelease(input.id,input.revision,actor,undefined,expiry));}
 if(url.pathname==='/edit'){const input=await request.json() as{id:string;editId:string;revision:number;title:string;notes:string};return Response.json(await this.editRelease(input.id,input.editId,input.revision,{title:input.title,notes:input.notes},actor,undefined,expiry));}
 if(url.pathname==='/releases')return Response.json(await this.releases(actor,undefined,expiry));
 return new Response('not found',{status:404});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'failure'},{status:409});}}
}
export default{fetch:(request:Request,env:Env)=>env.REPOSITORY_CONTROLLER.getByName('fixture').fetch(request)};
