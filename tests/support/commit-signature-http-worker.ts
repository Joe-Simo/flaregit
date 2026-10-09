import worker from '../../src/server/worker';
import {RepositoryController} from '../../src/server/durable-object';
import {accountKeyFor,accountOf} from '../../src/server/projects';
import {PrivateRecoveryOperations} from '../../src/server/private-recovery';
import type {SigningTrustSnapshot} from '../../src/server/commit-signature-inspection';
import type {Env} from '../../src/server/env';
const SIGNATURE_FIXTURE_KEY='AAAAC3NzaC1lZDI1NTE5AAAAIL+NbGiKGIW7hZQwEIsoQAQo1fH1IVFF7Tm+yeA03BEj';
export class CommitSignatureHttpFixture extends RepositoryController{
 private revokeAtFinalTrust?:{id:string;reads:number};
 async armFinalTrustRevocation(id:string){this.revokeAtFinalTrust={id,reads:0};}
 override async signingTrustSnapshot(credential?:{hash:string;userId:string;projectId:string}):Promise<SigningTrustSnapshot>{if(this.revokeAtFinalTrust&&++this.revokeAtFinalTrust.reads===2){await this.revokeApiToken(this.revokeAtFinalTrust.id);this.revokeAtFinalTrust=undefined;}return super.signingTrustSnapshot(credential);}
 async deleteDuringGpgParse(armored:string){const adding=this.addTrustedGpgKey(armored).then(()=>false,()=>true);await this.beginAccountDeletion();await this.finishAccountDeletion();const refused=await adding,exists=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='trusted_gpg_keys'").toArray().length;return{refused,lifecycle:await this.accountLifecycle(),keys:exists?this.ctx.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM trusted_gpg_keys').toArray()[0]?.n??0:0};}
 private rawBase64='';private providerId='signature-provider';private infoReads=0;private commands=0;private minted=0;private stopped=true;private revoked=true;private effect='';private effectActor='member';private sealed=new Set<string>();
 async signatureSeed(projectId:string,rawBase64:string){
  const bytes=Uint8Array.from(atob(rawBase64),character=>character.charCodeAt(0)),header=new TextEncoder().encode(`commit ${bytes.length}\0`),object=new Uint8Array(header.length+bytes.length);object.set(header);object.set(bytes,header.length);
  const commit=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1',object)),byte=>byte.toString(16).padStart(2,'0')).join('');this.rawBase64=rawBase64;
  await this.initialize({projectId,projectName:'Signature protocol fixture',canonicalRepoName:'signature-fixture',head:commit,verificationPolicy:{kind:'git-integrity'},ownerId:'owner'});new PrivateRecoveryOperations(this.ctx.storage).incarnation();await this.addMember('member','member');return{commit};
 }
 async signatureMode(input:{effect?:string;actor?:string;stopped?:boolean;revoked?:boolean;rawBase64?:string}){this.effect=input.effect??'';this.effectActor=input.actor??'member';this.stopped=input.stopped!==false;this.revoked=input.revoked!==false;this.providerId='signature-provider';this.infoReads=0;if(input.rawBase64!==undefined)this.rawBase64=input.rawBase64;await this.addMember('member','member');}
 async signatureStats(){return{commands:this.commands,minted:this.minted,infoReads:this.infoReads};}
 protected override branchRepositoryProvider(){return{get:async()=>({info:async()=>{this.infoReads++;if(this.effect==='provider'&&this.infoReads>=2)this.providerId='changed-provider';return{name:'signature-fixture',id:this.providerId,defaultBranch:'main',remote:`https://${'a'.repeat(32)}.artifacts.cloudflare.net/signature-fixture`};},createToken:async(scope:'read'|'write',ttl:number)=>{this.minted++;return{plaintext:'synthetic-signature-transport-token',scope,expiresAt:new Date(Date.now()+ttl*1000).toISOString()};},revokeToken:async()=>this.revoked,[Symbol.dispose]:()=>{}})} as unknown as Env['ARTIFACTS'];}
 protected override branchNativeSandbox(nativeId:string){return{exec:async(args:string[])=>{
  this.commands++;if(this.sealed.has(nativeId))throw Error('Stopped native attempt cannot restart');const command=args[2]??'';if(!command.includes('/usr/local/bin/bun'))return{success:true,stdout:'',stderr:'',exitCode:0};
  // Mutations happen across the awaited native read, before production's post-command authority fence.
  if(this.effect==='member'){this.ctx.storage.sql.exec('DELETE FROM members WHERE user_id=?',this.effectActor);this.effect='';}
  if(this.effect==='key'||this.effect==='key-regrant'){const effect=this.effect,account=accountOf(this.env,await accountKeyFor(this.effectActor));await account.removeTrustedSigningKey(SIGNATURE_FIXTURE_KEY);if(effect==='key-regrant')await account.addTrustedSigningKey('ssh-ed25519 '+SIGNATURE_FIXTURE_KEY+' fixture@localhost');this.effect='';}
  return{success:true,stdout:this.rawBase64+'\n',stderr:'',exitCode:0};
 },seal:async()=>{this.sealed.add(nativeId);},destroy:async()=>{},lifetimeStatus:async()=>({sealed:this.sealed.has(nativeId),state:this.stopped?'stopped':'stopping'})} as unknown as ReturnType<Env['INTEGRATOR']['getByName']>;}
}
export default{async fetch(request:Request,env:Env&{FIXTURE_ISSUER:string},ctx:ExecutionContext){
 const url=new URL(request.url),projectId=url.searchParams.get('project')??'p123456789abc',repository=env.REPOSITORY_CONTROLLER.getByName('project:'+projectId) as unknown as CommitSignatureHttpFixture;
 if(url.pathname==='/fixture/seed'){const input=await request.json() as {rawBase64:string};return Response.json(await repository.signatureSeed(projectId,input.rawBase64));}
 if(url.pathname==='/fixture/mode'){await repository.signatureMode(await request.json() as Parameters<CommitSignatureHttpFixture['signatureMode']>[0]);return Response.json({configured:true});}
 if(url.pathname==='/fixture/stats')return Response.json(await repository.signatureStats());
 if(url.pathname==='/fixture/token'){const actor=url.searchParams.get('actor')??'member',key=await accountKeyFor(actor),token=`fgt_${key}_${crypto.randomUUID().replaceAll('-','')}`,issued=await accountOf(env,key).createApiToken(actor,'Signature read fixture',token,{scope:'read',repo:projectId});return Response.json({token,id:issued.id});}
 if(url.pathname==='/fixture/revoke'){const input=await request.json() as {actor:string;id:string};await accountOf(env,await accountKeyFor(input.actor)).revokeApiToken(input.id);return Response.json({revoked:true});}
 if(url.pathname==='/fixture/final-trust-revoke'){const input=await request.json() as {actor:string;id:string};const account=env.REPOSITORY_CONTROLLER.getByName('account:'+await accountKeyFor(input.actor)) as unknown as CommitSignatureHttpFixture;await account.armFinalTrustRevocation(input.id);return Response.json({armed:true});}
 if(url.pathname==='/fixture/delete-during-key-parse'){const {armored}=await request.json() as {armored:string};const account=env.REPOSITORY_CONTROLLER.getByName('account:'+await accountKeyFor('parse-deleted')) as unknown as CommitSignatureHttpFixture;return Response.json(await account.deleteDuringGpgParse(armored));}
 if(url.pathname==='/fixture/key'){const actor=url.searchParams.get('actor')??'member';return Response.json(await accountOf(env,await accountKeyFor(actor)).addTrustedSigningKey(`ssh-ed25519 ${SIGNATURE_FIXTURE_KEY} protocol-fixture`));}
 return worker.fetch(request,{...env,CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:'https://fixture.example',API_LIMITER:{limit:async()=>({success:true})},LOOKUP_LIMITER:{limit:async()=>({success:true})}} as unknown as Env,ctx);
}};
