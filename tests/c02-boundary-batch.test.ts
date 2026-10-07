import {test,expect} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {workerdChild} from './support/workerd-child';

test('actual local workerd boundary controller seals loss of ACK and withdrawn authority without replay; no VM is provisioned',async()=>{
 if(await workerdChild('tests/c02-boundary-batch.test.ts'))return;
 const directory=await mkdtemp(join(tmpdir(),'c02-boundary-batch-')),entry=join(directory,'harness.ts'),output=join(directory,'harness.js');
 await Bun.write(entry,`
 import {DurableObject} from 'cloudflare:workers';
 import {C02BoundaryBatch} from ${JSON.stringify(resolve('src/server/c02-boundary-batch.ts'))};
 import {c02BoundaryNativeNames} from ${JSON.stringify(resolve('src/server/c02-boundary-native.ts'))};
 export class LocalBatch extends C02BoundaryBatch {configure(enabled){this.env.C02_BOUNDARY_ENABLED=enabled?'true':'false';} async inspectRefusal(){return this.ctx.storage.sql.exec('SELECT doc FROM c02_boundary_refusals').toArray().length;}}
 export class FakeNative extends DurableObject{
  read(){return this.ctx.storage.get('state');}
  async configure(mode){await this.ctx.storage.put('mode',mode);}
  async prepare(plan,role){const prior=await this.read();if(prior)return;await this.ctx.storage.put('state',{plan,role,image:this.env.C02_BOUNDARY_IMAGE,phase:'prepared',commands:[],nativeStopped:false,inspectedAt:null});}
  async startA(){await this.ctx.storage.put('starts',(await this.ctx.storage.get('starts')??0)+1);const s=await this.read();await this.ctx.storage.put('state',{...s,phase:'ready'});if(await this.ctx.storage.get('mode')==='hold')await new Promise(resolve=>{this.release=resolve;});if(await this.ctx.storage.get('mode')==='lost-ack')throw Error('Local lost ACK');return this.read();}
  async releaseA(){this.release?.();}
  async runB(){await this.ctx.storage.put('runs',(await this.ctx.storage.get('runs')??0)+1);const s=await this.read();await this.ctx.storage.put('state',{...s,phase:'dispatched'});await new Promise(resolve=>{this.release=resolve;});throw Error('Local held B ends without fabricated proof');}
  async inspectA(){throw Error('Not reached by these local negative tests');}
  async stop(){await this.ctx.storage.put('stops',(await this.ctx.storage.get('stops')??0)+1);const s=await this.read();if(!s)return null;const next={...s,phase:'stopped',nativeStopped:true,inspectedAt:Date.now()};await this.ctx.storage.put('state',next);return next;}
  status(){return this.read();}
  async counts(){return{starts:await this.ctx.storage.get('starts')??0,runs:await this.ctx.storage.get('runs')??0,stops:await this.ctx.storage.get('stops')??0};}
 }
 export default {async fetch(request,env){const url=new URL(request.url),name=url.searchParams.get('case')??'default',batch=env.BOUNDARY_SUPERVISOR.getByName(name),a=env.BOUNDARY_NATIVE.getByName(c02BoundaryNativeNames.taskA),b=env.BOUNDARY_NATIVE.getByName(c02BoundaryNativeNames.taskB);try{const body=request.method==='POST'?await request.json():{};
 if(url.pathname==='/configure'){await batch.configure(body.enabled);await a.configure(body.mode??'lost-ack');return Response.json({ok:true});}
 if(url.pathname==='/start')return Response.json(await batch.start(body.requestId));
 if(url.pathname==='/status')return Response.json(await batch.status());
 if(url.pathname==='/recover')return Response.json(await batch.recover(body.requestId));
 if(url.pathname==='/release'){await a.releaseA();return Response.json({ok:true});}
 if(url.pathname==='/counts')return Response.json({a:await a.counts(),b:await b.counts()});
 if(url.pathname==='/refuse')return Response.json({accepted:await batch.recordNativeRefusal(body.props,body.url,body.method)});
 return new Response('Not found',{status:404});}catch{return new Response('Refused',{status:409});}}};
 `);
 try{const build=Bun.spawn([process.execPath,'build',entry,'--target=browser','--external=cloudflare:workers',`--outfile=${output}`],{stdout:'ignore',stderr:'pipe'});const[stderr,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code)throw Error(stderr);
 const script=await Bun.file(output).text();const modes=['lost-ack','withdraw','prepared-cleanup'];const mf=new Miniflare(convertV4MiniflareOptions({workers:modes.map(mode=>({name:'boundary-'+mode,modules:true,script,compatibilityDate:'2026-10-05',compatibilityFlags:['nodejs_compat'],durableObjects:{BOUNDARY_SUPERVISOR:{className:'LocalBatch',useSQLite:true},BOUNDARY_NATIVE:{className:'FakeNative',useSQLite:true}},bindings:{C02_BOUNDARY_ENABLED:'false',C02_BOUNDARY_IMAGE:`registry.cloudflare.com/${'a'.repeat(32)}/boundary@sha256:${'b'.repeat(64)}`,C02_SOURCE_VERSION:'c'.repeat(40),CF_VERSION_METADATA:{id:'local-version'}}}))}));
 // Separate local emulator namespaces avoid sharing the fixed native identities across cases.
 try{for(const mode of modes){const worker=await mf.getWorker('boundary-'+mode),call=(path:string,body?:unknown)=>worker.fetch('https://local'+path,body===undefined?undefined:{method:'POST',body:JSON.stringify(body)});const requestId=crypto.randomUUID();expect((await call('/start',{requestId})).status).toBe(409);await call('/configure',{enabled:true,mode:mode==='lost-ack'?'lost-ack':'hold'});await call('/start',{requestId});const wait=async(predicate:(state:{batch:{phase:string}|null})=>boolean)=>{for(let index=0;index<100;index++){const state=await(await call('/status')).json() as {batch:{phase:string}|null};if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Local controller did not reach awaited phase '+mode+' '+JSON.stringify(await(await call('/status')).json())+' '+JSON.stringify(await(await call('/counts')).json()));};
 await wait(state=>state.batch?.phase==='a_possible'||state.batch?.phase==='held');if(mode!=='lost-ack'){let entered=false;for(let index=0;index<100;index++){const count=await(await call('/counts')).json() as {a:{starts:number}};if(count.a.starts===1){entered=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}expect(entered).toBe(true);}expect((await call('/refuse',{props:{requestId,scope:{taskId:crypto.randomUUID(),instanceId:'forged'}},url:'http://c02-boundary.invalid/supervisor',method:'POST'})).status).toBe(200);expect(await(await call('/refuse',{props:{requestId,scope:{taskId:crypto.randomUUID(),instanceId:'forged'}},url:'http://c02-boundary.invalid/supervisor',method:'POST'})).json()).toEqual({accepted:false});expect((await call('/recover',{requestId:crypto.randomUUID()})).status).toBe(409);
 if(mode==='withdraw'){await call('/configure',{enabled:false,mode:'hold'});await call('/release');}
 if(mode==='prepared-cleanup'){await call('/recover',{requestId});await call('/release');}
 await wait(state=>state.batch?.phase==='held');if(mode==='lost-ack'){await call('/start',{requestId});await call('/recover',{requestId});}
 const counts=await(await call('/counts')).json() as {a:{starts:number};b:{runs:number}};expect(counts.a.starts).toBeLessThanOrEqual(1);expect(counts.b.runs).toBe(0);expect((await call('/start',{requestId:crypto.randomUUID()})).status).toBe(409);
 }}finally{await mf.dispose();}
 }finally{await rm(directory,{recursive:true,force:true});}
},30000);
