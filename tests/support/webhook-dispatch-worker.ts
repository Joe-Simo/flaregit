import {RepositoryController} from "../../src/server/durable-object";
import type {Env} from "../../src/server/env";
export class WebhookDispatchFixture extends RepositoryController{
 private consumeBeforeEnqueue:"success"|"failed"|null=null;
 private fail=true;
 private lastQueued:unknown=null;
 private holdNext=false;
 private releaseHeld:(()=>void)|null=null;
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);Object.assign(this.env,{INTEGRATION_QUEUE:{send:async(body:unknown)=>{this.lastQueued=body;if(this.holdNext){this.holdNext=false;await new Promise<void>(resolve=>{this.releaseHeld=resolve;});}if(this.fail)throw new Error("synthetic-private-provider-diagnostic");}}});}
 protected override async enqueueWebhookDelivery(id:string,delaySeconds=0,blockedSequence?:number,expectedGeneration?:number){
  if(this.consumeBeforeEnqueue){const outcome=this.consumeBeforeEnqueue;this.consumeBeforeEnqueue=null;const {generation}=this.ctx.storage.sql.exec<{generation:number}>("SELECT generation FROM deliveries WHERE id=?",id).one();await this.markDelivery(id,{generation,ok:outcome==="success",status:outcome==="success"?204:503,final:true});}
  return super.enqueueWebhookDelivery(id,delaySeconds,blockedSequence,expectedGeneration);
 }
 override async fetch(request:Request){const route=new URL(request.url).pathname;
 if(route==="/seed"){await this.initialize({projectId:"p123456789abc",projectName:"Synthetic dispatch",canonicalRepoName:"fixture",head:"a".repeat(40),verificationPolicy:{}});this.ctx.storage.sql.exec("INSERT INTO deliveries(id,webhook_id,event,status,attempts,payload,created_at,updated_at) VALUES('dlv_fixture','wh_fixture','deployment.requested','pending',0,?, ?, ?)",JSON.stringify({id:"evt_fixture",data:{commit:"a".repeat(40)}}),new Date().toISOString(),new Date().toISOString());return new Response("ok");}
 if(route==="/replay-consumed"){this.fail=false;this.consumeBeforeEnqueue=new URL(request.url).searchParams.get("outcome")==="failed"?"failed":"success";try{await this.redeliver("dlv_fixture");return new Response("ok");}catch(error){return Response.json({error:error instanceof Error?error.message:"unknown"},{status:503});}}
 if(route==="/replay"){try{await this.redeliver("dlv_fixture");return new Response("ok");}catch(error){return Response.json({error:error instanceof Error?error.message:"unknown"},{status:503});}}
 if(route==="/recover"){this.fail=false;return Response.json(await this.enqueueWebhookDelivery("dlv_fixture"));}
 if(route==="/hold"){this.fail=false;this.holdNext=true;return Response.json(await this.enqueueWebhookDelivery("dlv_fixture"));}
 if(route==="/release"){this.releaseHeld?.();return new Response("ok");}
 if(route==="/queued-body")return Response.json(this.lastQueued);
 if(route==="/alarm-recover"){this.fail=false;this.ctx.storage.sql.exec("UPDATE deliveries SET created_at='2026-01-01T00:00:00.000Z',updated_at='2026-01-01T00:00:00.000Z' WHERE id='dlv_fixture'");await this.alarm();return new Response("ok");}
 if(route==="/defer-fail"){this.fail=true;const url=new URL(request.url);await this.deferBlockedWebhook("dlv_fixture",Number(url.searchParams.get("generation")),Number(url.searchParams.get("sequence")));return new Response("ok");}
 if(route==="/defer"){this.fail=false;const url=new URL(request.url);const generation=Number(url.searchParams.get("generation"));await this.deferBlockedWebhook("dlv_fixture",generation,Number(url.searchParams.get("sequence")));return new Response("ok");}
 if(route==="/receiver"){await this.markDelivery("dlv_fixture",{generation:2,ok:true,status:204});return new Response("ok");}
 return Response.json(this.ctx.storage.sql.exec("SELECT id,generation,attempts,status,payload,dispatch_state,dispatch_attempts,dispatch_error FROM deliveries WHERE id='dlv_fixture'").one());
 }
}
export default{fetch:(request:Request,env:{TEST:DurableObjectNamespace<WebhookDispatchFixture>})=>env.TEST.getByName("fixture").fetch(request)};
