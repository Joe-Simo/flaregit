import {test,expect} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {workerdChild} from './support/workerd-child';
import type {C02BoundaryPlan} from '../src/server/c02-boundary-programs';

test('actual local workerd boundary wrapper binds native identities and refuses callback evidence before the original attacker command',async()=>{
 if(await workerdChild('tests/c02-boundary-native.test.ts'))return;
 const directory=await mkdtemp(join(tmpdir(),'c02-boundary-native-')),source=join(directory,'harness.ts'),output=join(directory,'harness.js');
 await Bun.write(source,`
 import {DurableObject} from 'cloudflare:workers';
 import {C02BoundaryNative,C02BoundaryDeny,c02BoundaryNativeNames} from ${JSON.stringify(resolve('src/server/c02-boundary-native.ts'))};
 import {C02BoundarySupervisorLedger} from ${JSON.stringify(resolve('src/server/c02-boundary-supervisor.ts'))};
 export {C02BoundaryDeny};
 export class BoundaryNativeFixture extends C02BoundaryNative{
  registrationCount(){if(!this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='c02_boundary_registration'").toArray().length)return 0;return this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM c02_boundary_registration').one().n;}
 }
 export class BoundarySupervisorFixture extends DurableObject{
  ledger(){return new C02BoundarySupervisorLedger(this.ctx.storage);}
  async register(plan){await this.ledger().register(plan,'8'.repeat(64));}
  async recordNativeRefusal(props,url,method){await this.ctx.storage.put('callbackCalls',(await this.ctx.storage.get('callbackCalls')??0)+1);return this.ledger().refuse(props,new Request(url,{method}))!==null;}
  async report(){return{callbackCalls:await this.ctx.storage.get('callbackCalls')??0,refusals:this.ledger().refusals()};}
 }
 export default{async fetch(request,env,ctx){const path=new URL(request.url).pathname,body=request.method==='POST'?await request.json():null,role=body?.role??'task-a',name=role==='task-b'?c02BoundaryNativeNames.taskB:c02BoundaryNativeNames.taskA,native=env.BOUNDARY_NATIVE.getByName(name),supervisor=env.BOUNDARY_SUPERVISOR.getByName(c02BoundaryNativeNames.supervisor);
  try{if(path==='/ids')return Response.json({a:env.BOUNDARY_NATIVE.idFromName(c02BoundaryNativeNames.taskA).toString(),b:env.BOUNDARY_NATIVE.idFromName(c02BoundaryNativeNames.taskB).toString()});
   if(path==='/prepare'){await native.prepare(body.plan,body.role);return Response.json({prepared:true});}
   if(path==='/supervisor'){await supervisor.register(body.plan);return Response.json({prepared:true});}
   if(path==='/wrong-namespace'){await env.BOUNDARY_NATIVE.getByName('foreign-boundary-namespace').prepare(body.plan,'task-a');return Response.json({unexpected:true});}
   if(path==='/public')return await native.fetch(new Request('https://local/recordNativeRefusal',{method:'POST',body:'{}'}));
   if(path==='/deny')return await ctx.exports.C02BoundaryDeny({props:body.props}).fetch(new Request(body.url,{method:'POST',headers:body.headers??{}}));
   if(path==='/authorized')return Response.json({authorized:await native.callbackAuthorized(body.props)});
   if(path==='/count')return Response.json({count:await native.registrationCount()});
   if(path==='/status')return Response.json(await native.status());
   if(path==='/report')return Response.json(await supervisor.report());
   return new Response('Not found',{status:404});
  }catch{return new Response('Refused',{status:409});}
 }};
 `);
 try{const build=Bun.spawn([process.execPath,'build',source,'--target=browser','--external=cloudflare:workers',`--outfile=${output}`],{stdout:'ignore',stderr:'pipe'});const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code)throw Error(error);
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'boundary-native-wrapper-local-not-VM-proof',modules:true,script:await Bun.file(output).text(),compatibilityDate:'2026-10-04',compatibilityFlags:['nodejs_compat'],bindings:{C02_BOUNDARY_ENABLED:'true',C02_BOUNDARY_IMAGE:`registry.cloudflare.com/${'a'.repeat(32)}/c02-boundary@sha256:${'b'.repeat(64)}`},durableObjects:{BOUNDARY_NATIVE:{className:'BoundaryNativeFixture',useSQLite:true},BOUNDARY_SUPERVISOR:{className:'BoundarySupervisorFixture',useSQLite:true}}}]}));
 try{const worker=await mf.getWorker('boundary-native-wrapper-local-not-VM-proof'),call=(path:string,body?:unknown)=>worker.fetch('https://local'+path,body===undefined?undefined:{method:'POST',body:JSON.stringify(body)});const ids=await(await call('/ids')).json() as {a:string;b:string},createdAt=Date.now(),plan:C02BoundaryPlan={requestId:crypto.randomUUID(),taskA:{taskId:crypto.randomUUID(),instanceId:ids.a},taskB:{taskId:crypto.randomUUID(),instanceId:ids.b},createdAt,deadlineAt:createdAt+120000,taskMarker:'1'.repeat(64),rootMarker:'2'.repeat(64),syntheticCredential:'3'.repeat(64),tamperMarker:'4'.repeat(64),actionNonces:{supervisor:'5'.repeat(64),foreignTask:'6'.repeat(64),credentialAction:'7'.repeat(64)}};
 expect(ids.a).not.toBe(ids.b);
 expect((await call('/prepare',{plan,role:'invalid-role'})).status).toBe(409);expect(await(await call('/count')).json()).toEqual({count:0});
 expect((await call('/wrong-namespace',{plan})).status).toBe(409);expect((await call('/prepare',{plan:{...plan,taskA:{...plan.taskA,instanceId:ids.b}},role:'task-a'})).status).toBe(409);expect(await(await call('/count')).json()).toEqual({count:0});
 for(const role of ['task-a','task-b']){expect((await call('/prepare',{plan,role})).status).toBe(200);expect((await call('/prepare',{plan,role})).status).toBe(200);const state=await(await call('/status',{role})).json();expect(state).toMatchObject({role,phase:'prepared',commands:[],nativeStopped:false});expect((await call('/public',{role})).status).not.toBe(200);}
 expect((await call('/prepare',{plan:{...plan,rootMarker:'9'.repeat(64)},role:'task-a'})).status).toBe(409);expect((await call('/prepare',{plan:{...plan,taskB:plan.taskA,taskA:plan.taskB},role:'task-b'})).status).toBe(409);
 expect((await call('/supervisor',{plan})).status).toBe(200);const props={requestId:plan.requestId,scope:plan.taskB},url='http://c02-boundary.invalid/supervisor?'+new URLSearchParams({requestId:plan.requestId,instanceId:plan.taskB.instanceId,taskId:plan.taskB.taskId,targetTaskId:plan.taskA.taskId,nonce:plan.actionNonces.supervisor});
 expect(await(await call('/authorized',{role:'task-b',props})).json()).toEqual({authorized:false});
 expect((await call('/deny',{props,url,headers:{'X-Native-Instance':ids.b,'X-Source':'registered-native-boundary'}})).status).toBe(403);
 expect((await call('/deny',{props:{...props,scope:{...plan.taskB,instanceId:ids.a}},url})).status).toBe(403);
 expect((await call('/deny',{props:{...props,requestId:crypto.randomUUID()},url})).status).toBe(403);
 expect((await call('/deny',{props:{...props,source:'registered-native-boundary'},url})).status).toBe(409);
 expect(await(await call('/report')).json()).toEqual({callbackCalls:0,refusals:[]});expect(await(await call('/status',{role:'task-b'})).json()).toMatchObject({phase:'prepared',commands:[]});
 }finally{await mf.dispose();}
 }finally{await rm(directory,{recursive:true,force:true});}
},30000);
