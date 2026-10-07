import {RequestIntentFixture} from './integration-request-intents-worker';
import type{Env}from'../../src/server/env';
import {PrivateRecoveryOperations}from'../../src/server/private-recovery';
import {accountOf,accountKeyFor,admitRun}from'../../src/server/projects';
export class NativePhaseFixture extends RequestIntentFixture{
 async exercisePhase(mode:string){await this.seed();const key=crypto.randomUUID(),eventId=`integ-p123456789abc-${key}`,now=Date.now();this.env.RUNS_ENABLED='false';this.env.CF_VERSION_METADATA={id:crypto.randomUUID(),tag:'test',timestamp:new Date().toISOString()};this.env.FLAREGIT_SOURCE_VERSION='1'.repeat(40);this.env.INTEGRATION_NATIVE_PHASE_JSON=JSON.stringify({projectId:'p123456789abc',incarnation:new PrivateRecoveryOperations(this.ctx.storage).incarnation(),expectedEventId:eventId,actorId:'owner',sourceVersion:this.env.FLAREGIT_SOURCE_VERSION,image:`registry.cloudflare.com/${'a'.repeat(32)}/verifier@sha256:${'b'.repeat(64)}`,acceptedBase:'a'.repeat(40),contributions:[{taskId:'alpha',commit:'b'.repeat(40)}],activatedAt:now-1000,admissionExpiresAt:now+60000,nativeStopAt:now+1260000,maxAllocations:1,maxContainerSeconds:1200,maxCommands:64,kind:'native-essential'});
 const input={idempotencyKey:key,taskIds:['alpha'],expected:{acceptedCommit:'a'.repeat(40),policyVersion:1,contributions:[{taskId:'alpha',commit:'b'.repeat(40),base:'a'.repeat(40),acceptedTarget:null,targetGeneration:null}]}};
 await this.prepareIntegrationRequest(input,{userId:'owner',displayName:'Owner',viaToken:false},undefined,now+60000);
 if(mode==='release')this.env.CF_VERSION_METADATA={id:crypto.randomUUID(),tag:'changed',timestamp:new Date().toISOString()};
 if(mode==='revoked')this.ctx.storage.sql.exec("DELETE FROM members WHERE user_id='owner'");
 if(mode==='stale'){const state=await this.getState();state.tasks.alpha!.currentCommit='c'.repeat(40);this.ctx.storage.sql.exec('UPDATE project SET doc=? WHERE id=1',JSON.stringify(state));await this.getState();}
 let allowed=false;try{allowed=await this.integrationNativePhaseAdmission(mode==='legacy'?'legacy':eventId);}catch{}
 const normal=await admitRun(this.env,accountOf(this.env,await accountKeyFor('owner')),0,eventId);return{allowed,normalStatus:normal?.status,requests:this.ctx.storage.sql.exec('SELECT request_key FROM integration_request_intents').toArray().length};
 }
}
export default{fetch:async(request:Request,env:Env)=>Response.json(await(env.REPOSITORY_CONTROLLER.getByName(new URL(request.url).pathname) as unknown as NativePhaseFixture).exercisePhase(new URL(request.url).pathname.slice(1)))};
