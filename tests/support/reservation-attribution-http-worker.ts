import worker from "../../src/server/worker";
import {RepositoryController} from "../../src/server/durable-object";
import {accountKeyFor} from "../../src/server/projects";
import {ManagedSpendLedger} from "../../src/server/managed-spend-ledger";
import type {Env} from "../../src/server/env";
interface FixtureEnv extends Env{FIXTURE_ISSUER:string;TEST:DurableObjectNamespace<ReservationFixture>}
export class ReservationFixture extends RepositoryController {
 async arm(){await this.ctx.storage.put("revoke",true);}
 override async managedReservationAttribution(input:{month:string;cursor?:string}){const page=await super.managedReservationAttribution(input);if(await this.ctx.storage.get("revoke")){await this.ctx.storage.delete("revoke");await (this.env as FixtureEnv).TEST.getByName(`account:${await accountKeyFor("owner")}`).beginAccountDeletion();}return page;}
 async seed(){const ledger=new ManagedSpendLedger(this.ctx.storage);ledger.reserve({runId:"fixture_native",accountKey:"private_fixture",usdMicros:43008,maxInputBytes:1,maxOutputTokens:1,maxCalls:1,maxContainerSeconds:1200},{accountUsdMicros:500000,globalUsdMicros:500000});ledger.consume("fixture_native",0,0,1200);}
 async token(key:string){return this.createApiToken("owner","fixture",`fgt_${key}_${"x".repeat(32)}`,{scope:"full"});}
}
export default {async fetch(request:Request,env:FixtureEnv,ctx:ExecutionContext){const key=await accountKeyFor("owner"),token=`fgt_${key}_${"x".repeat(32)}`;if(new URL(request.url).pathname==="/fixture/arm"){await env.TEST.getByName("global").arm();return Response.json({ok:true});}if(new URL(request.url).pathname==="/fixture/seed"){await env.TEST.getByName("global").seed();await env.TEST.getByName(`account:${key}`).token(key);return Response.json({token});}return worker.fetch(request,{...env,REPOSITORY_CONTROLLER:env.TEST,OPERATOR_ACCOUNTS:key,CLERK_ISSUER:env.FIXTURE_ISSUER,CLERK_AUTHORIZED_PARTIES:"https://fixture.example",API_LIMITER:{limit:async()=>({success:true})}} as unknown as Env,ctx);}};
