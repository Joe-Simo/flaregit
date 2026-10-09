import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
type Attachment={id:string;name:string;sha256:string;size:number;phase:'pending'|'verified'|'removed';canRemove:boolean;canReconcile:boolean};
async function fixture(){
 const file=`/tmp/flaregit-attachments-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,'build','tests/support/issue-attachments-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*','--outfile='+file],{stdout:'ignore',stderr:'pipe'});
 try{if(await build.exited)throw Error(await new Response(build.stderr).text());const script=await Bun.file(file).text();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'attachments',unsafeDirectSockets:[{host:'127.0.0.1',port:0}],modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{REPOSITORY_CONTROLLER:{className:'IssueAttachmentFixture',useSQLite:true}},r2Buckets:{EVIDENCE_BUCKET:'attachment-bytes'}}]}));
 try{const endpoint=await mf.unsafeGetDirectURL('attachments');await fetch(endpoint.origin+'/fixture/seed');const token=await(await fetch(endpoint.origin+'/fixture/token')).json() as {secret:string;id:string};const headers={Authorization:`Bearer ${token.secret}`,'CF-Connecting-IP':'192.0.2.48'};return{mf,endpoint,token,headers};}catch(error){await mf.dispose();throw error;}
 }finally{await Bun.file(file).delete();}
}
async function hash(bytes:Uint8Array<ArrayBuffer>){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');}
const name='issue attachments use production HTTP and R2 with immutable requests, bounded binary uploads and removal fences';
test(name,async()=>{
 if(await workerdChild('tests/issue-attachments-http.test.ts',name))return;
 const {mf,endpoint,headers,token}=await fixture();const base=endpoint.origin+'/api/p/p123456789abc/issues/1/attachments';
 const prepare=(input:Attachment|{id:string;name:string;sha256:string;size:number})=>fetch(base,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id:input.id,name:input.name,sha256:input.sha256,size:input.size})});
 try{
  const bytes=new Uint8Array([0,255,128,10,13,0,1]),sha256=await hash(bytes),input={id:crypto.randomUUID(),name:'evidence.bin',sha256,size:bytes.length};
  expect((await fetch(base)).status).not.toBe(200);
  const prepared=await prepare(input);expect(prepared.status).toBe(201);expect((await prepared.json() as Attachment).phase).toBe('pending');
  const replay=await prepare(input);expect(replay.status).toBe(201);expect((await replay.json() as Attachment).id).toBe(input.id);
  expect((await prepare({...input,name:'changed.bin'})).status).toBe(409);
  const content=base+'/'+input.id+'/content';expect((await fetch(content,{headers})).status).toBe(409);
  const chunked=()=>new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes.subarray(0,2));controller.enqueue(bytes.subarray(2));controller.close();}});
  const uploaded=await fetch(content,{method:'PUT',headers:{...headers,'Content-Type':'application/octet-stream'},body:chunked()});expect(uploaded.status).toBe(200);expect((await uploaded.json() as Attachment).phase).toBe('verified');
  const download=await fetch(content,{headers});expect(download.status).toBe(200);expect(download.headers.get('Content-Type')).toBe('application/octet-stream');expect(download.headers.get('Content-Disposition')).toStartWith('attachment;');expect(download.headers.get('Cache-Control')).toContain('no-store');expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  expect((await fetch(content)).status).not.toBe(200);expect((await fetch(content.replace('/issues/1/','/issues/2/'),{headers})).status).toBe(404);
  const reconciled=await fetch(base+'/'+input.id+'/reconcile',{method:'POST',headers});expect(reconciled.status).toBe(200);expect((await reconciled.json() as Attachment).phase).toBe('verified');
  const references=await(await fetch(base+'/references',{headers})).json() as {bytesIncluded:boolean;restoreSupported:boolean};expect(references.bytesIncluded).toBe(false);expect(references.restoreSupported).toBe(false);
  expect((await fetch(base+'/'+input.id,{method:'DELETE',headers})).status).toBe(200);expect((await fetch(content,{headers})).status).toBe(404);expect((await prepare(input)).status).toBe(410);
  for(const kind of ['wrong hash','short body'] as const){const body=new Uint8Array([9,8,7,6]);const original={id:crypto.randomUUID(),name:kind+'.bin',sha256:await hash(body),size:body.length};expect((await prepare(original)).status).toBe(201);const url=base+'/'+original.id+'/content';const invalid=kind==='wrong hash'?new Uint8Array([1,2,3,4]):body.subarray(0,2);expect((await fetch(url,{method:'PUT',headers,body:new ReadableStream<Uint8Array>({start(controller){controller.enqueue(invalid);controller.close();}})})).status).not.toBe(200);expect((await prepare(original)).status).toBe(201);expect((await fetch(url,{method:'PUT',headers,body})).status).toBe(200);expect(new Uint8Array(await(await fetch(url,{headers})).arrayBuffer())).toEqual(body);}
  expect((await prepare({id:crypto.randomUUID(),name:'huge.bin',sha256:'f'.repeat(64),size:5*1024*1024+1})).status).not.toBe(201);
  for(let index=0;index<8;index++){const body=new Uint8Array([index,42]);expect((await prepare({id:crypto.randomUUID(),name:`file-${index}.bin`,sha256:await hash(body),size:body.length})).status).toBe(201);}
  expect((await prepare({id:crypto.randomUUID(),name:'eleventh.bin',sha256:'e'.repeat(64),size:1})).status).toBe(413);
  const list=await(await fetch(base,{headers})).json() as {attachments:Attachment[];canUpload:boolean};expect(list.attachments).toHaveLength(10);expect(list.attachments.some(row=>row.id===input.id)).toBe(false);expect(list.canUpload).toBe(true);
  await fetch(endpoint.origin+'/fixture/revoke?id='+token.id);expect((await fetch(base,{headers})).status).not.toBe(200);
 }finally{await mf.dispose();}
},60000);

const raceName='issue attachment removal and owned retention fence concurrent reconciliation and same-hash generations';
test(raceName,async()=>{
 if(await workerdChild('tests/issue-attachments-http.test.ts',raceName))return;
 const {mf,endpoint,headers}=await fixture(),origin=endpoint.origin,base=origin+'/api/p/p123456789abc/issues/1/attachments';
 const bytes=new Uint8Array([255,0,8,13]),sha256=await hash(bytes);
 const prepare=(id:string)=>fetch(base,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id,name:'race.bin',sha256,size:bytes.length})});
 const upload=(id:string)=>fetch(`${base}/${id}/content`,{method:'PUT',headers,body:bytes});
 const pause=async(kind:'get'|'delete')=>{expect((await fetch(`${origin}/fixture/arm?kind=${kind}`)).status).toBe(200);};
 const waitPaused=async()=>{const deadline=Date.now()+3000;while(Date.now()<deadline){const value=await(await fetch(origin+'/fixture/pause-status')).json() as {paused:boolean};if(value.paused)return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Owned R2 operation did not reach its pause');};
 let inFlight:Promise<Response>|undefined;
 try{
  const original=crypto.randomUUID();expect((await prepare(original)).status).toBe(201);expect((await upload(original)).status).toBe(200);
  await pause('get');inFlight=fetch(`${base}/${original}/reconcile`,{method:'POST',headers});await waitPaused();
  expect((await fetch(`${base}/${original}`,{method:'DELETE',headers})).status).toBe(200);
  await fetch(`${origin}/fixture/expire?id=${original}`);
  expect((await fetch(base+'/retention',{method:'POST',headers})).status).toBe(409);
  const next=crypto.randomUUID();expect((await prepare(next)).status).toBe(409);
  await fetch(origin+'/fixture/resume');expect((await inFlight).status).not.toBe(200);inFlight=undefined;
  expect((await fetch(`${base}/${original}/content`,{headers})).status).toBe(404);
  const removedList=await(await fetch(base,{headers})).json() as {attachments:Attachment[]};expect(removedList.attachments.some(row=>row.id===original)).toBe(false);
  await fetch(`${origin}/fixture/expire?id=${original}`);await pause('delete');inFlight=fetch(base+'/retention',{method:'POST',headers});await waitPaused();
  expect((await fetch(base+'/retention',{method:'POST',headers})).status).toBe(409);
  expect((await prepare(next)).status).toBe(409);
  // A second execution cannot release the first execution's admission hold.
  expect((await prepare(next)).status).toBe(409);
  await fetch(origin+'/fixture/resume');expect((await inFlight).status).toBe(200);inFlight=undefined;
  expect((await prepare(next)).status).toBe(201);expect((await upload(next)).status).toBe(200);
  // Old physical generation deletes never target the newly admitted bytes.
  expect((await fetch(origin+'/fixture/late-delete')).status).toBe(200);
  const fresh=await fetch(`${base}/${next}/content`,{headers});expect(fresh.status).toBe(200);expect(new Uint8Array(await fresh.arrayBuffer())).toEqual(bytes);
 }finally{await fetch(origin+'/fixture/resume').catch(()=>undefined);await inFlight?.catch(()=>undefined);await mf.dispose();}
},60000);

const copyProofName='a new issue attachment cannot adopt old removed issue bytes without its own verified upload';
test(copyProofName,async()=>{
 if(await workerdChild('tests/issue-attachments-http.test.ts',copyProofName))return;
 const {mf,endpoint,headers}=await fixture(),root=endpoint.origin+'/api/p/p123456789abc/issues',bytes=new Uint8Array([0,255,42,128,7]),sha256=await hash(bytes);
 const prepare=(issue:number,id:string)=>fetch(`${root}/${issue}/attachments`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id,name:'private-evidence.bin',sha256,size:bytes.length})});
 try{
  const oldId=crypto.randomUUID();expect((await prepare(1,oldId)).status).toBe(201);
  expect((await fetch(`${root}/1/attachments/${oldId}/content`,{method:'PUT',headers,body:bytes})).status).toBe(200);
  const detail=await(await fetch(root+'/1',{headers})).json() as {stateRevision:number};
  expect((await fetch(root+'/1',{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:detail.stateRevision,requestId:crypto.randomUUID(),confirmed:true})})).status).toBe(200);
  const newId=crypto.randomUUID();expect((await prepare(2,newId)).status).toBe(201);
  const base=`${root}/2/attachments/${newId}`;
  // Knowledge of an old digest and size proves no possession of its bytes.
  expect((await fetch(base+'/reconcile',{method:'POST',headers})).status).not.toBe(200);
  expect((await fetch(base+'/content',{headers})).status).not.toBe(200);
  expect((await fetch(base+'/content',{method:'PUT',headers,body:bytes})).status).toBe(200);
  const reconciled=await fetch(base+'/reconcile',{method:'POST',headers});expect(reconciled.status).toBe(200);expect((await reconciled.json() as Attachment).phase).toBe('verified');
  const download=await fetch(base+'/content',{headers});expect(download.status).toBe(200);expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
 }finally{await mf.dispose();}
},60000);

const ownInputName='attachment lost acknowledgments retain original caller proof without certifying uncertain bytes';
test(ownInputName,async()=>{
 if(await workerdChild('tests/issue-attachments-http.test.ts',ownInputName))return;
 const {mf,endpoint,headers}=await fixture(),origin=endpoint.origin,base=origin+'/api/p/p123456789abc/issues/1/attachments';
 const bytes=new Uint8Array([255,0,13,10,128,6]),sha256=await hash(bytes),id=crypto.randomUUID(),input={id,name:'owned-transfer.bin',sha256,size:bytes.length};
 const prepare=(value:typeof input)=>fetch(base,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(value)});
 const upload=(target:string,value:Uint8Array<ArrayBuffer>)=>fetch(`${base}/${target}/content`,{method:'PUT',headers,body:new ReadableStream<Uint8Array>({start(controller){controller.enqueue(value);controller.close();}})});
 try{
  expect((await prepare(input)).status).toBe(201);expect((await fetch(origin+'/fixture/drop-ack')).status).toBe(200);
  expect((await upload(id,bytes)).status).not.toBe(200);
  const uncertain=await fetch(`${base}/${id}/reconcile`,{method:'POST',headers});const uncertainBody=await uncertain.text();expect(uncertainBody.toLowerCase()).not.toContain('must upload');expect(uncertainBody.toLowerCase()).not.toContain('upload bytes before');expect(uncertainBody.toLowerCase()).not.toContain('upload the original file bytes');if(uncertain.ok)expect((JSON.parse(uncertainBody) as Attachment).phase).not.toBe('verified');
  expect((await fetch(`${base}/${id}/content`,{headers})).status).not.toBe(200);
  expect((await fetch(origin+'/fixture/complete-late-write')).status).toBe(200);
  const late=await fetch(`${base}/${id}/reconcile`,{method:'POST',headers});if(late.ok)expect((await late.json() as Attachment).phase).toBe('pending');
  expect((await prepare(input)).status).toBe(201);expect((await upload(id,bytes)).status).toBe(200);
  const confirmed=await fetch(`${base}/${id}/reconcile`,{method:'POST',headers});expect(confirmed.status).toBe(200);expect((await confirmed.json() as Attachment).phase).toBe('verified');
  expect(new Uint8Array(await(await fetch(`${base}/${id}/content`,{headers})).arrayBuffer())).toEqual(bytes);
  const list=await(await fetch(base,{headers})).json() as {attachments:Attachment[]};expect(list.attachments).toHaveLength(1);expect(list.attachments[0]!.id).toBe(id);
  for(const invalid of [new Uint8Array([1,2,3,4,5,6,7]),bytes.subarray(0,2)]){
   const original={...input,id:crypto.randomUUID(),name:'invalid-transfer.bin',sha256:await hash(new Uint8Array([...bytes,9])),size:bytes.length+1};expect((await prepare(original)).status).toBe(201);expect((await upload(original.id,invalid)).status).not.toBe(200);
   const denied=await fetch(`${base}/${original.id}/reconcile`,{method:'POST',headers});expect(denied.status).toBe(409);expect((await denied.text()).toLowerCase()).toContain('upload the original file bytes');
   expect((await prepare(original)).status).toBe(201);expect((await upload(original.id,new Uint8Array([...bytes,9]))).status).toBe(200);expect((await fetch(`${base}/${original.id}/reconcile`,{method:'POST',headers})).status).toBe(200);
  }
 }finally{await mf.dispose();}
},60000);
