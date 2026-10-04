import {RepositoryController} from "../../src/server/durable-object";
import worker from "../../src/server/worker";
import {accountKeyFor} from "../../src/server/projects";
import type{Env}from"../../src/server/env";

/** Synthetic provider adapters only; account lifecycle/import records use production SQLite methods. */
export class AccountDeletionFixture extends RepositoryController {
  override async fetch(request:Request):Promise<Response> {
    const route=new URL(request.url).pathname;
    const env=this.env as Env&{FIXTURE_ISSUER:string};
    const account=this.env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor("deletion-user")}`) as unknown as RepositoryController;
    if(route==="/fixture"){
      await account.saveImportJob({id:"abcdef123456",ownerId:"deletion-user",name:"Pending import",canonicalRepoName:"pending-import-fixture",source:"https://example.com/repo.git",branch:"main",verificationPolicy:{kind:"command",test:"bun test"},status:"pending",historyIntent:"provider-default-no-depth-requested",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),detail:"Synthetic pending import"});
      await account.claimImportHistoryOperation({projectId:"abcdef123456",head:"a".repeat(40),canonicalRepoName:"pending-import-fixture",ownerId:"deletion-user",instanceId:"import-history-deletion-fixture"});
      return Response.json({ready:true});
    }
    if(route==="/flags"){await this.ctx.storage.put("flags",await request.json());return Response.json({ok:true});}
    if(route==="/stats")return Response.json({lifecycle:await account.accountLifecycle(),imports:await account.listImportJobs(),deleteCalls:await this.ctx.storage.get("deleteCalls")??[],terminateCalls:await this.ctx.storage.get("terminateCalls")??0});
    const flags=await this.ctx.storage.get<{workflowAvailable?:boolean;shutdownConfirmed?:boolean;importReady?:boolean;deleteConfirmed?:boolean}>("flags")??{};
    const providerEnv={...env,CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:"http://test",API_LIMITER:{limit:async()=>({success:true})},
      IMPORT_HISTORY_WORKFLOW:{get:async(id:string)=>{
        if(id!=="import-history-deletion-fixture"||!flags.workflowAvailable)throw new Error("Synthetic workflow lookup unavailable");
        return{status:async()=>({status:flags.shutdownConfirmed&&await this.ctx.storage.get("terminateCalls")?"terminated":"running"}),terminate:async()=>{await this.ctx.storage.put("terminateCalls",Number(await this.ctx.storage.get("terminateCalls")??0)+1);}};
      }},
      INTEGRATOR:{getByName:()=>{throw new Error("Deletion must not allocate native inspection");}},
      ARTIFACTS:{get:async(name:string)=>{
        if(name!=="pending-import-fixture")throw new Error("Unexpected fixture repository");
        return{info:async()=>{if(!flags.importReady)throw Object.assign(new Error("Synthetic import allocation pending"),{code:"IMPORT_IN_PROGRESS"});return{defaultBranch:"main",remote:"https://artifacts.example.com/fixture"};},log:async()=>{throw new Error("Deletion must not use SDK Git authority");},createToken:async()=>{throw new Error("Deletion must not issue Git credentials");},[Symbol.dispose]() {}};
      },delete:async(name:string)=>{const calls=await this.ctx.storage.get<string[]>("deleteCalls")??[];calls.push(name);await this.ctx.storage.put("deleteCalls",calls);return flags.deleteConfirmed===true;}}
    } as unknown as Env;
    return worker.fetch(request,providerEnv,this.ctx as unknown as ExecutionContext);
  }
}
export default {fetch:(request:Request,env:Env)=>(env.REPOSITORY_CONTROLLER.getByName("deletion-fixture") as unknown as AccountDeletionFixture).fetch(request)};
