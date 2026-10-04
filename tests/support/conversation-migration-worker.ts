import {RepositoryController} from '../../src/server/durable-object';
import {accountOf,accountKeyFor} from '../../src/server/projects';
import type {Env} from '../../src/server/env';
export class ConversationMigrationFixture extends RepositoryController {
 private reads=0;
 override async reserveCoreGitOperation(){return{allowed:true,existing:false,basis:'conservative_operation_envelope'} as const;}
 protected override async migrationProviderFetch(request:Request){this.reads++;if(request.redirect!=='manual')throw Error('Redirects must be rejected manually');if(request.headers.has('Authorization'))throw Error('Unexpected provider credential');const path=new URL(request.url).pathname;const data=path.endsWith('/issues')?[{id:10,node_id:'I10',number:1,html_url:'https://github.com/owner/repo/issues/1',user:{id:123,login:'external-person'},title:'Imported public issue',body:'Original issue body',state:'open',comments:0,created_at:'2026-10-04T00:00:00Z',updated_at:'2026-10-04T00:00:00Z',closed_at:null}]:{id:1,node_id:'R1',html_url:'https://github.com/owner/repo',private:false};return Response.json(data);}
 override async fetch(request:Request){const url=new URL(request.url),actor={userId:url.searchParams.get('actor')??'owner',displayName:'Owner',viaToken:false},expiry=Date.now()+60000;try{
 if(url.pathname==='/seed'){await this.initialize({projectId:'p123456789abc',projectName:'Fixture',canonicalRepoName:'canonical',head:'a'.repeat(40),verificationPolicy:{},ownerId:'owner',kind:'import'});const account=accountOf(this.env,await accountKeyFor('owner'));await account.saveImportJob({id:'p123456789abc',ownerId:'owner',name:'Fixture',canonicalRepoName:'canonical',source:'https://github.com/owner/repo.git',branch:'main',status:'ready',historyIntent:'provider-default-no-depth-requested',verificationPolicy:{kind:'command',test:'bun test'},createdAt:'2026-10-04T00:00:00Z',updatedAt:'2026-10-04T00:00:00Z',detail:'Synthetic imported source'});return Response.json({seeded:true});}
 if(url.pathname==='/begin')return Response.json(await this.beginConversationMigration({operationId:'migration-one',repositoryId:'1',repositoryNodeId:'R1'},actor,undefined,expiry));
 if(url.pathname==='/capture')return Response.json(await this.captureConversationMigration('migration-one',0,actor,undefined,expiry));
 if(url.pathname==='/manifest')return Response.json(await this.conversationMigrationManifest('migration-one',actor,undefined,expiry));
 if(url.pathname==='/publish'){const input=await request.json() as {eventId:string;expectedRevision:number;manifestHash:string};return Response.json(await this.publishConversationMigration('migration-one',input,actor,undefined,expiry));}
 if(url.pathname==='/list')return Response.json(await this.listConversationMigrations(actor,undefined,expiry));
 if(url.pathname==='/issues')return Response.json(await this.listIssues('open'));
 if(url.pathname==='/reads')return Response.json({reads:this.reads});
 return new Response('Missing fixture',{status:404});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Failure'},{status:409});}}
}
export default {fetch:(request:Request,env:Env)=>env.REPOSITORY_CONTROLLER.getByName('fixture').fetch(request)};
