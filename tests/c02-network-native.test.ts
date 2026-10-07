import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {workerdChild} from './support/workerd-child';
import type {C02NetworkProbePlan} from '../src/server/c02-network-probe';

test('local workerd scoped native wrapper refuses public writes, foreign identity and mutable registration without starting a VM',async()=>{
 if(await workerdChild('tests/c02-network-native.test.ts'))return;
 const directory=await mkdtemp(join(tmpdir(),'c02-network-native-'));
 const source=join(directory,'harness.ts'),output=join(directory,'harness.js');
 const module=resolve('src/server/c02-network-native.ts');
 await Bun.write(source,`
 import {C02NetworkSandbox,C02ScopedNetworkDeny} from ${JSON.stringify(module)};
 export {C02NetworkSandbox,C02ScopedNetworkDeny};
 const name='fixed-c02-network-native-v1';
 export default {async fetch(request,env,ctx){
  const native=env.NETWORK_NATIVE.getByName(name),path=new URL(request.url).pathname;
  try{
   if(path==='/id')return Response.json({instanceId:env.NETWORK_NATIVE.idFromName(name).toString()});
   if(path==='/prepare'){const body=await request.json();await native.prepare(body.plan,body.controls,body.commandId);return Response.json({prepared:true});}
   if(path==='/foreign'){await env.NETWORK_NATIVE.getByName('other-instance').status();return Response.json({unexpected:true});}
   if(path==='/public'){return await native.fetch(new Request('https://local/recordInterception',{method:'POST',body:'{}'}));}
   if(path==='/deny'){const body=await request.json();return await ctx.exports.C02ScopedNetworkDeny({props:body.props}).fetch(new Request(body.url,{headers:body.headers??{}}));}
   if(path==='/denials')return Response.json({denials:await native.denials()});
   if(path==='/status')return Response.json(await native.status());
   return new Response('Not found',{status:404});
  }catch{return new Response('Refused',{status:409});}
 }};
 `);
 try{
  const build=Bun.spawn([process.execPath,'build',source,'--target=browser','--external=cloudflare:workers',`--outfile=${output}`],{stdout:'ignore',stderr:'pipe'});
  const [stderr,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code)throw Error(stderr);
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'network-wrapper',modules:true,script:await Bun.file(output).text(),compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{NETWORK_NATIVE:{className:'C02NetworkSandbox',useSQLite:true}},bindings:{C02_NETWORK_ENABLED:'true',C02_NETWORK_IMAGE:`registry.cloudflare.com/${'a'.repeat(32)}/c02@sha256:${'b'.repeat(64)}`}}]}));
  try{
   const worker=await mf.getWorker('network-wrapper');const call=(path:string,body?:unknown)=>worker.fetch('https://local'+path,body===undefined?undefined:{method:'POST',body:JSON.stringify(body)});
   const {instanceId}=await(await call('/id')).json() as {instanceId:string};const now=Date.now();
   const plan:C02NetworkProbePlan={scope:{requestId:crypto.randomUUID(),instanceId,probeId:crypto.randomUUID()},createdAt:now,deadlineAt:now+120000,maxContainers:1,maxNativeSeconds:120,endpoints:[{channel:'https',receiverId:'owned',url:'https://flaregit-owned-delivery-verifier.simo-988.workers.dev/c02-network/probe',controlNonce:'c'.repeat(64),probeNonce:'d'.repeat(64)}]};
   const body={plan,commandId:crypto.randomUUID(),controls:[{scope:plan.scope,channel:'https',receiverId:'owned',nonce:'c'.repeat(64),receivedAt:now,kind:'control',source:'owned-receiver'}]};
   expect((await call('/prepare',body)).status).toBe(200);expect((await call('/prepare',body)).status).toBe(200);
   expect((await call('/foreign')).status).toBe(409);expect((await call('/prepare',{...body,plan:{...plan,scope:{...plan.scope,probeId:crypto.randomUUID()}}})).status).toBe(409);
   expect((await call('/public')).status).not.toBe(200);
   const url=plan.endpoints[0]!.url+'?'+new URLSearchParams({...plan.scope,channel:'https',nonce:'d'.repeat(64)});
   expect((await call('/deny',{props:{scope:{...plan.scope,instanceId:'forged'},interceptorId:'forged'},url,headers:{'X-Native-Instance':instanceId,'X-Interceptor-Id':'forged'}})).status).toBe(409);
   // A valid namespace alone cannot turn a pre-dispatch request into native evidence.
   expect((await call('/deny',{props:{scope:plan.scope,interceptorId:'unregistered'},url})).status).toBe(403);
   expect(await(await call('/denials')).json()).toEqual({denials:[]});expect(await(await call('/status')).json()).toMatchObject({phase:'prepared',commandSettled:true,nativeStopped:false});
  }finally{await mf.dispose();}
 }finally{await rm(directory,{recursive:true,force:true});}
},30000);
