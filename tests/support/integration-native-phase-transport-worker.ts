// LOCAL synthetic native transport. The real IntegratorSandbox start/guard path
// runs in workerd; no Cloudflare container, Docker process or hosted proof exists.
import {DurableObject} from 'cloudflare:workers';
import {IntegratorSandbox} from '../../src/server/integrator';
import type {Env} from '../../src/server/env';
import type {IntegrationNativeRuntimeScope} from '../../src/server/integration-native-runtime';
const image=`registry.cloudflare.com/${'a'.repeat(32)}/trusted@sha256:${'b'.repeat(64)}`;
export class PhaseRepository extends DurableObject<Env>{
 async authorizeIntegrationNativeCommand(){return true;}
 async integrationNativeCommandAllowed(){return true;}
 async finishIntegrationNativeCommand(){}
 async integrationNativeStart(scope:IntegrationNativeRuntimeScope){const now=Date.now();return{image,deadline:scope.candidateId==='deadline'?now-1:now+120000,admissionExpiresAt:scope.candidateId==='admission'?now-1:now+30000};}
}
export class PhaseIntegrator extends IntegratorSandbox{
 private startupGate=Promise.withResolvers<void>();private startupEntered=Promise.withResolvers<void>();private startupCalls=0;private mode='normal';private active=false;private starts=0;private execs=0;private destroys=0;private inspections=0;private sawStarted=false;private startOptions:unknown=null;
 async configure(mode:string){this.mode=mode;this.active=mode==='wrong-running-image';}
 async waitStartup(){await this.startupEntered.promise;}
 async releaseStartup(){this.startupGate.resolve();}
 protected override async startupOptions(){if(this.mode==='concurrent-start'){this.startupCalls++;if(this.startupCalls===2)this.startupEntered.resolve();await this.startupGate.promise;}if(this.mode==='source-drift')this.env.FLAREGIT_SOURCE_VERSION='d'.repeat(40);return{entrypoint:['sleep','infinity'],enableInternet:true,image:'ignored-unpinned-default'};}
 protected override nativeContainer(){const self=this;return{get running(){return self.active;},start(options:unknown){self.starts++;self.startOptions=options;const row=self.ctx.storage.sql.exec<{doc:string}>('SELECT doc FROM integration_native_phase_local WHERE id=1').toArray()[0];self.sawStarted=!!row&&JSON.parse(row.doc).started===true;if(self.mode==='lost-start')throw Error('Synthetic start ACK lost');self.active=self.mode!=='cold-null';},async inspect(){self.inspections++;if(!self.active)return null;return{image:self.mode==='wrong-running-image'?'wrong-image':image};},async exec(){self.execs++;return{output:async()=>({exitCode:0,stdout:new TextEncoder().encode('synthetic output'),stderr:new Uint8Array()})};},async destroy(){self.destroys++;self.active=false;}} as unknown as Container;}
 async facts(){const row=this.ctx.storage.sql.exec<{doc:string}>('SELECT doc FROM integration_native_phase_local WHERE id=1').toArray()[0];return{mode:this.mode,starts:this.starts,execs:this.execs,destroys:this.destroys,inspections:this.inspections,sawStarted:this.sawStarted,startOptions:this.startOptions,phase:row?JSON.parse(row.doc) as {started:boolean;deadline:number}:null,lifetime:await this.lifetimeStatus()};}
}
export default{async fetch(request:Request,env:Env){const body=await request.json() as {mode:string;nativeId:string;scope:IntegrationNativeRuntimeScope;commandId:string},job=env.INTEGRATOR.getByName(`native-${body.nativeId}`) as unknown as PhaseIntegrator,path=new URL(request.url).pathname;try{if(path==='/configure'){await job.configure(body.mode);return Response.json({ok:true});}if(path==='/wait-startup'){await job.waitStartup();return Response.json({ok:true});}if(path==='/release-startup'){await job.releaseStartup();return Response.json({ok:true});}if(path==='/exec')return Response.json(await job.integrationExec(body.scope,body.nativeId,body.commandId,['git','--version'],{timeoutMs:1000}));if(path==='/facts')return Response.json(await job.facts());if(path==='/cleanup'){await job.destroy();return Response.json(await job.facts());}return new Response('Missing',{status:404});}catch{return new Response('Refused',{status:409});}}};
