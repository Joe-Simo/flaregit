import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';

/** Miniflare's Node transport accepts async byte iterables; preserve chunking
 * and backpressure across the Bun/Web-stream boundary without buffering. */
async function* streamChunks(stream:ReadableStream<Uint8Array>):AsyncGenerator<Uint8Array>{
 const reader=stream.getReader();let complete=false;try{for(;;){const next=await reader.read();if(next.done){complete=true;return;}yield next.value;}}finally{
  if(!complete){try{void Promise.resolve(reader.cancel()).catch(()=>{});}catch{/* Cancellation is cleanup; read errors still propagate. */}}
  // Bun's native HTTP-body reader omits this optional cleanup operation.
  try{if(typeof reader.releaseLock==='function')reader.releaseLock();}catch{/* Bun's native reader exposes an unsupported release stub. */}
 }
}
const maskDiagnostic=(value:string,secret:string)=>value.replaceAll(secret,'[credential]').replaceAll(btoa('owner:'+secret),'[credential]').replace(/f(?:gt|gg)_[A-Za-z0-9_]+/g,'[credential]').replace(/Authorization[^\r\n]*/gi,'Authorization: [credential]').slice(-4096);
async function expectLfsStatus(result:Response,status:number,secret:string){
 if(result.status!==status){const reader=result.body?.getReader(),decoder=new TextDecoder();let text='';if(reader){try{while(text.length<2048){const next=await reader.read();if(next.done)break;text+=decoder.decode(next.value,{stream:true});}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}throw Error(`LFS HTTP expected ${status}, received ${result.status}: ${maskDiagnostic(text.slice(0,2048),secret)}`);}
 expect(result.status).toBe(status);
}

async function fixture(){
 const file=`/tmp/flaregit-lfs-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,'build','tests/support/lfs-http-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*','--outfile='+file],{stdout:'ignore',stderr:'pipe'});
 if(await build.exited)throw Error(await new Response(build.stderr).text());const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'lfs',unsafeDirectSockets:[{host:'127.0.0.1',port:0}],modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{REPOSITORY_CONTROLLER:{className:'LfsHttpFixture',useSQLite:true}},r2Buckets:{EVIDENCE_BUCKET:'lfs-objects'}}]}));
 const worker=await mf.getWorker('lfs');await worker.fetch('http://fixture/fixture/seed');const token=await(await worker.fetch('http://fixture/fixture/token')).json() as {secret:string;id:string};
 return{mf,worker,token};
}

test('production LFS HTTP verifies bytes, immutable size, private membership, public accepted pointers and revoked tokens',async()=>{
 if(await workerdChild('tests/lfs-http.test.ts','production LFS HTTP verifies bytes, immutable size, private membership, public accepted pointers and revoked tokens'))return;
 const {mf,token}=await fixture();const endpoint=await mf.unsafeGetDirectURL('lfs');
 try{
  const bytes=new Uint8Array([0,255,128,10,13,0,1]),oid=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  const task=endpoint.origin+'/git/p123456789abc/tasks/fixture-task.git/info/lfs/objects/',canonical=endpoint.origin+'/git/p123456789abc/canonical.git/info/lfs/objects/';
  const auth={Authorization:'Basic '+btoa('owner:'+token.secret),'CF-Connecting-IP':'192.0.2.40'};
  expect((await fetch(task.replace('objects/','locks/verify'),{method:'POST',headers:auth,body:'{}'})).status).toBe(501);
  expect((await fetch(task.replace('objects/','unsupported'),{headers:auth})).status).toBe(404);
  const batch=await fetch(task+'batch',{method:'POST',headers:{...auth,'Content-Type':'application/vnd.git-lfs+json'},body:JSON.stringify({operation:'upload',transfers:['basic'],objects:[{oid,size:bytes.length}]})});expect(batch.status).toBe(200);
  const payload=await batch.json() as {objects:{actions:{upload:{href:string}}}[]};expect(payload.objects[0]!.actions.upload.href).toBe(task+oid);expect(payload.objects[0]!.actions.upload.href).not.toContain('?');
  const chunked=()=>new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes);controller.close();}});
  expect((await fetch(task+'f'.repeat(64),{method:'PUT',headers:auth,body:chunked()})).status).not.toBe(200);
  // The admitted oid/size bounds a stock chunked transfer without Content-Length.
  await expectLfsStatus(await fetch(task+oid,{method:'PUT',headers:auth,body:chunked()}),200,token.secret);
  expect((await fetch(task+oid,{method:'PUT',headers:{...auth,'Content-Length':String(bytes.length)},body:bytes})).status).toBe(200);
  expect(new Uint8Array(await(await fetch(canonical+oid,{headers:auth})).arrayBuffer())).toEqual(bytes);
  expect((await fetch(canonical+oid)).status).not.toBe(200);
  expect((await fetch(task+oid,{method:'PUT',headers:{...auth,'Content-Length':'1'},body:new Uint8Array([0])})).status).not.toBe(200);
  await fetch(endpoint.origin+'/fixture/public',{method:'POST',body:JSON.stringify({oid,size:bytes.length})});
  const publicHeaders={'CF-Connecting-IP':'192.0.2.40'};expect(new Uint8Array(await(await fetch(canonical+oid,{headers:publicHeaders})).arrayBuffer())).toEqual(bytes);
  expect((await fetch(canonical+'e'.repeat(64),{headers:publicHeaders})).status).not.toBe(200);
  await fetch(endpoint.origin+'/fixture/private');expect((await fetch(canonical+oid,{headers:publicHeaders})).status).not.toBe(200);
  await fetch(endpoint.origin+'/fixture/revoke?id='+token.id);expect((await fetch(canonical+oid,{headers:auth})).status).not.toBe(200);
 }finally{await mf.dispose();}
},60000);

test.skipIf(!Bun.env.FLAREGIT_GIT_LFS_BIN)('stock Git LFS uploads and fetches binary content through the production Worker and R2 service',async()=>{
 if(await workerdChild('tests/lfs-http.test.ts','stock Git LFS uploads and fetches binary content through the production Worker and R2 service'))return;
 const {mf,token}=await fixture();const directory=await mkdtemp(join(tmpdir(),'flaregit-stock-lfs-'));
 const endpoint=await mf.unsafeGetDirectURL('lfs');
 try{
  await mkdir(join(directory,'repo'));const cwd=join(directory,'repo'),binary=new Uint8Array([0,255,128,10,13,0,1]);
  const env={...Bun.env,PATH:dirname(Bun.env.FLAREGIT_GIT_LFS_BIN!)+':'+Bun.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_TRACE:'1'};
  const mask=(value:string)=>maskDiagnostic(value,token.secret);
  const tail=async(stream:ReadableStream<Uint8Array>)=>{const reader=stream.getReader(),decoder=new TextDecoder();let output='';for(;;){const next=await reader.read();if(next.done)return(output+decoder.decode()).slice(-8192);output=(output+decoder.decode(next.value,{stream:true})).slice(-8192);}};
  const run=async(command:string[])=>{const process=Bun.spawn(command,{cwd,env,stdout:'pipe',stderr:'pipe'});let timedOut=false;const timer=setTimeout(()=>{timedOut=true;process.kill();},20000);try{const [out,error,code]=await Promise.all([tail(process.stdout),tail(process.stderr),process.exited]);if(code!==0)throw Error(`LFS CLI ${command[0]?.split('/').at(-1)} ${command[1]??''} failed (code ${code}, timedOut ${timedOut})\n${mask(out+error)}`);}finally{clearTimeout(timer);}};

  await run(['git','init']);await run(['git','config','user.name','LFS fixture']);await run(['git','config','user.email','fixture@example.test']);await run(['git','remote','add','origin',endpoint.origin+'/git/p123456789abc/tasks/fixture-task.git']);
  await run(['git','config','http.'+endpoint.origin+'/.extraHeader','Authorization: Basic '+btoa('owner:'+token.secret)]);
  await run(['git','config','--add','http.'+endpoint.origin+'/.extraHeader','CF-Connecting-IP: 192.0.2.41']);
  await run([Bun.env.FLAREGIT_GIT_LFS_BIN!,'install','--local']);await run([Bun.env.FLAREGIT_GIT_LFS_BIN!,'track','binary.dat']);await Bun.write(join(cwd,'binary.dat'),binary);await run(['git','add','.']);await run(['git','commit','-m','Track verified binary']);
  await run([Bun.env.FLAREGIT_GIT_LFS_BIN!,'push','--all','origin']);
  await rm(join(cwd,'.git/lfs/objects'),{recursive:true,force:true});await run([Bun.env.FLAREGIT_GIT_LFS_BIN!,'fetch','--all','origin']);
  const oid=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',binary)),byte=>byte.toString(16).padStart(2,'0')).join('');
  expect(new Uint8Array(await Bun.file(join(cwd,'.git/lfs/objects',oid.slice(0,2),oid.slice(2,4),oid)).arrayBuffer())).toEqual(binary);
  await Bun.write(join(cwd,'binary.dat'),`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${binary.length}\n`);await run([Bun.env.FLAREGIT_GIT_LFS_BIN!,'checkout']);
  expect(new Uint8Array(await Bun.file(join(cwd,'binary.dat')).arrayBuffer())).toEqual(binary);
 }finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
},60000);

for(const mode of ['session','pat'] as const){
 const name=`LFS ${mode} upload refuses its original maintainer consent after revoke and regrant during a stalled read`;
 test(name,async()=>{
  if(await workerdChild('tests/lfs-http.test.ts',name))return;
  const {mf,worker,token}=await fixture();let release:()=>void=()=>{};const abort=new AbortController();
  try{
   const bytes=new Uint8Array([0,255,128,10,13,0,1]),oid=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
   const base='http://fixture/git/p123456789abc/tasks/member-task.git/info/lfs/objects/',headers={Authorization:'Basic '+btoa('owner:'+token.secret),'Content-Type':'application/vnd.git-lfs+json'};
   const batch=await worker.fetch(base+'batch',{method:'POST',headers,body:JSON.stringify({operation:'upload',objects:[{oid,size:bytes.length}]})});expect(batch.status).toBe(200);
   const gate=new Promise<void>(resolve=>{release=resolve;});let sent=false;
   const body=new ReadableStream<Uint8Array>({async pull(controller){if(sent){controller.close();return;}await gate;sent=true;controller.enqueue(bytes);controller.close();}},{highWaterMark:0});
   const upload=worker.fetch(mode==='pat'?base+oid:'http://fixture/fixture/session-upload?oid='+oid,{method:'PUT',...(mode==='pat'?{headers}:{}),body:streamChunks(body),duplex:'half',signal:abort.signal});
   const deadline=Date.now()+2000;let waiting=false;
   while(Date.now()<deadline){const status=await(await worker.fetch('http://fixture/fixture/lfs-read-status')).json() as {waiting:boolean;reads:number};if(status.waiting&&status.reads>0){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
   expect(waiting).toBe(true);expect((await worker.fetch('http://fixture/fixture/regrant')).status).toBe(200);release();
   expect((await upload).status).not.toBe(200);
   expect((await worker.fetch('http://fixture/git/p123456789abc/canonical.git/info/lfs/objects/'+oid,{headers})).status).not.toBe(200);
   const nextBytes=new Uint8Array([7,9,255]),nextOid=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',nextBytes)),value=>value.toString(16).padStart(2,'0')).join('');
   expect((await worker.fetch(base+'batch',{method:'POST',headers,body:JSON.stringify({operation:'upload',objects:[{oid:nextOid,size:nextBytes.length}]})})).status).toBe(200);
   // A fresh request under the new epoch succeeds; the old stream alone is refused.
   expect((await worker.fetch(base+nextOid,{method:'PUT',headers,body:nextBytes})).status).toBe(200);
  }finally{release();abort.abort();await mf.dispose();}
 },60000);
}

test('rejected LFS producer bytes release confirmed holds so same-oid retries and eight malformed uploads recover',async()=>{
 const name='rejected LFS producer bytes release confirmed holds so same-oid retries and eight malformed uploads recover';if(await workerdChild('tests/lfs-http.test.ts',name))return;
 const {mf,worker,token}=await fixture();
 try{
  const base='http://fixture/git/p123456789abc/tasks/fixture-task.git/info/lfs/objects/',headers={Authorization:'Basic '+btoa('owner:'+token.secret)},bytes=new Uint8Array([0,255,128,10,13,0,1]);
  const oidOf=async(data:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),value=>value.toString(16).padStart(2,'0')).join('');
  const admit=async(oid:string,size:number)=>{const result=await worker.fetch(base+'batch',{method:'POST',headers,body:JSON.stringify({operation:'upload',objects:[{oid,size}]})});expect(result.status).toBe(200);const batch=await result.json() as {objects:{error?:unknown}[]};expect(batch.objects[0]?.error).toBeUndefined();};
  const upload=(oid:string,data:Uint8Array<ArrayBuffer>)=>worker.fetch(base+oid,{method:'PUT',headers,body:streamChunks(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(data);controller.close();}})),duplex:'half'});
  const oid=await oidOf(bytes);await admit(oid,bytes.length);expect((await upload(oid,bytes.slice(0,1))).status).not.toBe(200);
  await admit(oid,bytes.length);const incorrect=bytes.slice();incorrect[0]=1;expect((await upload(oid,incorrect)).status).not.toBe(200);
  await admit(oid,bytes.length);expect((await upload(oid,bytes)).status).toBe(200);
  for(let index=0;index<8;index++){const expected=new Uint8Array([index+10,255,128,10,13,0,1]),nextOid=await oidOf(expected);await admit(nextOid,expected.length);expect((await upload(nextOid,new Uint8Array([0]))).status).not.toBe(200);}
  const final=new Uint8Array([42,255,128,10,13,0,1]),finalOid=await oidOf(final);await admit(finalOid,final.length);expect((await upload(finalOid,final)).status).toBe(200);
  expect((await worker.fetch('http://fixture/fixture/delete-lfs')).status).toBe(200);
 }finally{await mf.dispose();}
},60000);

for(const receipt of [false,true]){
 const name=`LFS uncertain writes ${receipt?'recover from an owned atomic receipt':'retain quota and block deletion without a completion receipt'}`;
 test(name,async()=>{
  if(await workerdChild('tests/lfs-http.test.ts',name))return;const {mf,worker,token}=await fixture();
  try{
   const bytes=new Uint8Array([0,255,128,10,13,0,1]),oid=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join(''),base='http://fixture/git/p123456789abc/tasks/fixture-task.git/info/lfs/objects/',headers={Authorization:'Basic '+btoa('owner:'+token.secret)};
   expect((await worker.fetch(base+'batch',{method:'POST',headers,body:JSON.stringify({operation:'upload',objects:[{oid,size:bytes.length}]})})).status).toBe(200);
   await worker.fetch(`http://fixture/fixture/unknown-write?oid=${oid}&receipt=${receipt}`);
   expect((await worker.fetch(base+oid+'/reconcile',{method:'POST',headers})).status).toBe(receipt?200:409);
   if(receipt){await worker.fetch(base+'batch',{method:'POST',headers,body:JSON.stringify({operation:'upload',objects:[{oid,size:bytes.length}]})});expect((await worker.fetch(base+oid,{method:'PUT',headers,body:bytes})).status).toBe(200);}
   expect((await worker.fetch('http://fixture/fixture/delete-lfs')).status).toBe(receipt?200:409);
  }finally{await mf.dispose();}
 },60000);
}

test('a full valid LFS body with a lost SDK response retains its hold until an owned late atomic completion receipt exists',async()=>{
 const name='a full valid LFS body with a lost SDK response retains its hold until an owned late atomic completion receipt exists';if(await workerdChild('tests/lfs-http.test.ts',name))return;
 const {mf,worker,token}=await fixture();
 try{
  const bytes=new Uint8Array([0,255,128,10,13,0,1]),oid=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join(''),base='http://fixture/git/p123456789abc/tasks/fixture-task.git/info/lfs/objects/',headers={Authorization:'Basic '+btoa('owner:'+token.secret)};
  await worker.fetch(base+'batch',{method:'POST',headers,body:JSON.stringify({operation:'upload',objects:[{oid,size:bytes.length}]})});await worker.fetch('http://fixture/fixture/drop-ack');
  expect((await worker.fetch(base+oid,{method:'PUT',headers,body:bytes})).status).not.toBe(200);
  expect(await(await worker.fetch('http://fixture/fixture/write-status?oid='+oid)).json()).toMatchObject({phase:'unknown',emittedBytes:bytes.length,producerClosed:true,writeSettled:true});
  expect((await worker.fetch(base+oid+'/reconcile',{method:'POST',headers})).status).toBe(409);
  expect((await worker.fetch('http://fixture/fixture/delete-lfs')).status).toBe(409);
  await worker.fetch('http://fixture/fixture/complete-late-write');expect((await worker.fetch('http://fixture/fixture/delete-lfs')).status).toBe(200);
 }finally{await mf.dispose();}
},60000);

test('an invalid zero-size LFS oid is rejected before any SDK write and cannot leave a durable write marker',async()=>{
 const name='an invalid zero-size LFS oid is rejected before any SDK write and cannot leave a durable write marker';if(await workerdChild('tests/lfs-http.test.ts',name))return;
 const {mf,worker,token}=await fixture();
 try{
  const oid='e'.repeat(64),base='http://fixture/git/p123456789abc/tasks/fixture-task.git/info/lfs/objects/',headers={Authorization:'Basic '+btoa('owner:'+token.secret)};
  await worker.fetch(base+'batch',{method:'POST',headers,body:JSON.stringify({operation:'upload',objects:[{oid,size:0}]})});expect((await worker.fetch(base+oid,{method:'PUT',headers,body:streamChunks(new ReadableStream<Uint8Array>({start(controller){controller.close();}})),duplex:'half'})).status).not.toBe(200);
  expect(await(await worker.fetch('http://fixture/fixture/write-status?oid='+oid)).json()).toBeNull();expect((await worker.fetch('http://fixture/fixture/delete-lfs')).status).toBe(200);
 }finally{await mf.dispose();}
},60000);
