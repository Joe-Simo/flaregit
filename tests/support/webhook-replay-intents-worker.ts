import {RequestIntentFixture} from './integration-request-intents-worker';
import type{Env}from'../../src/server/env';
export class ReplayIntentFixture extends RequestIntentFixture{
 async exerciseReplay(mode:string){await this.seed();let calls=0;this.env.INTEGRATION_QUEUE={send:async()=>{calls++;throw Error('Synthetic lost ACK');}} as unknown as Env['INTEGRATION_QUEUE'];const stamp=new Date().toISOString();this.ctx.storage.sql.exec("INSERT INTO deliveries(id,webhook_id,event,status,attempts,payload,created_at,updated_at) VALUES('delivery','hook','change.accepted','failed',3,?, ?, ?)",JSON.stringify({id:'original-event'}),stamp,stamp);const actor={userId:'owner',displayName:'Owner',viaToken:false},input={idempotencyKey:crypto.randomUUID(),expectedGeneration:0};let firstFailed=false;try{await this.redeliverOriginal('delivery',input,actor);}catch{firstFailed=true;}
 if(mode==='consumed')await this.markDelivery('delivery',{generation:1,ok:true,status:204,final:true});
 if(mode==='revoked')this.ctx.storage.sql.exec("DELETE FROM members WHERE user_id='owner'");
 let retryFailed=false,retry=false;try{retry=await this.redeliverOriginal('delivery',mode==='changed'?{...input,expectedGeneration:1}:input,mode==='foreign'?{...actor,userId:'member'}:actor);}catch{retryFailed=true;}
 return{firstFailed,retry,retryFailed,calls,row:this.ctx.storage.sql.exec('SELECT generation,attempts,status,dispatch_state,payload FROM deliveries WHERE id=?','delivery').toArray()[0],intents:this.ctx.storage.sql.exec('SELECT request_key FROM webhook_replay_intents').toArray().length,listGeneration:(await this.listDeliveries(10))[0]?.generation};
 }
}
export default{fetch:async(request:Request,env:Env)=>Response.json(await(env.REPOSITORY_CONTROLLER.getByName(new URL(request.url).pathname) as unknown as ReplayIntentFixture).exerciseReplay(new URL(request.url).pathname.slice(1)))};
