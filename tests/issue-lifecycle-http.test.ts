import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';

async function fixture(){
 const file=`/tmp/flaregit-issue-lifecycle-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,'build','tests/support/issue-lifecycle-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*','--outfile='+file],{stdout:'ignore',stderr:'pipe'});
 try{
  if(await build.exited)throw Error(await new Response(build.stderr).text());
  const script=await Bun.file(file).text();
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'issue-lifecycle',unsafeDirectSockets:[{host:'127.0.0.1',port:0}],modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{REPOSITORY_CONTROLLER:{className:'IssueLifecycleFixture',useSQLite:true}},r2Buckets:{EVIDENCE_BUCKET:'issue-lifecycle-bytes'}}]}));
  try{
   const origin=(await mf.unsafeGetDirectURL('issue-lifecycle')).origin;await fetch(origin+'/fixture/seed');
   const token=await(await fetch(origin+'/fixture/token')).json() as {secret:string;id:string};
   const headers={Authorization:`Bearer ${token.secret}`,'CF-Connecting-IP':'192.0.2.50','Content-Type':'application/json'};
   const base=origin+'/api/p/p123456789abc';
   const remove=(number:number,input:{expectedRevision:number;requestId:string;confirmed:boolean})=>fetch(base+'/issues/'+number,{method:'DELETE',headers,body:JSON.stringify(input)});
   return{mf,origin,token,headers,base,remove};
  }catch(error){await mf.dispose();throw error;}
 }finally{await Bun.file(file).delete();}
}

const lifecycleName='issue deletion HTTP preserves tombstones and original request identity without resurrection';
test(lifecycleName,async()=>{
 if(await workerdChild('tests/issue-lifecycle-http.test.ts',lifecycleName))return;
 const f=await fixture();
 try{
  const creation={title:'Deletion receipt fixture',body:'Private body must not survive in deleted HTTP views',idempotencyKey:crypto.randomUUID()};
  const create=()=>fetch(f.base+'/issues',{method:'POST',headers:f.headers,body:JSON.stringify(creation)});
  const created=await create();expect(created.status).toBe(201);const issue=await created.json() as {number:number};
  const comment=await fetch(f.base+'/comments',{method:'POST',headers:f.headers,body:JSON.stringify({subject:'issue:'+issue.number,body:'Private discussion'})});expect(comment.status).toBe(201);
  const attachment={id:crypto.randomUUID(),name:'retained.bin',sha256:'a'.repeat(64),size:1};
  expect((await fetch(f.base+'/issues/'+issue.number+'/attachments',{method:'POST',headers:f.headers,body:JSON.stringify(attachment)})).status).toBe(201);
  const planning=await fetch(f.base+'/planning',{method:'POST',headers:f.headers,body:JSON.stringify({operation:'addItem',expectedVersion:0,issueNumber:issue.number})});expect(planning.status).toBe(200);
  const related=await fetch(f.base+'/issue-features',{method:'PATCH',headers:f.headers,body:JSON.stringify({expectedRevision:0,action:{kind:'relation-add',relation:'duplicate-of',from:1,to:issue.number}})});expect(related.status).toBe(200);
  const viewed=await fetch(f.base+'/issues/'+issue.number,{headers:f.headers});expect(viewed.status).toBe(200);const current=await viewed.json() as {stateRevision:number};
  const input={expectedRevision:current.stateRevision,requestId:crypto.randomUUID(),confirmed:true};
  expect((await f.remove(issue.number,{...input,confirmed:false})).status).toBe(400);
  expect((await f.remove(issue.number,{...input,expectedRevision:current.stateRevision+1})).status).toBe(409);
  const member=await(await fetch(f.origin+'/fixture/member-token')).json() as {secret:string};
  expect((await fetch(f.base+'/issues/'+issue.number,{method:'DELETE',headers:{...f.headers,Authorization:`Bearer ${member.secret}`},body:JSON.stringify(input)})).status).not.toBe(200);
  // Ignore the first response receipt to model an acknowledgment lost after canonical commit.
  expect((await f.remove(issue.number,input)).status).toBe(200);
  const replay=await f.remove(issue.number,input);expect(replay.status).toBe(200);expect((await replay.json() as {replayed:boolean}).replayed).toBe(true);
  const audit=await(await fetch(f.origin+'/fixture/audit?number='+issue.number)).json() as {markers:number;retained:number};
  expect(audit).toEqual({markers:1,retained:1});
  expect((await f.remove(issue.number,{...input,requestId:crypto.randomUUID()})).status).toBe(410);
  const deleted=await fetch(f.base+'/issues/'+issue.number,{headers:f.headers});expect(deleted.status).toBe(410);
  const deletedBody=await deleted.text();expect(deletedBody).not.toContain(creation.body);expect(deletedBody).not.toContain(creation.title);
  expect((await fetch(f.base+'/issues/'+issue.number,{method:'PATCH',headers:f.headers,body:JSON.stringify({state:'closed',expectedRevision:current.stateRevision,requestId:crypto.randomUUID()})})).status).toBe(410);
  const comments=await fetch(f.base+'/comments?subject=issue:'+issue.number,{headers:f.headers});expect(comments.status).not.toBe(200);
  expect((await fetch(f.base+'/issues/'+issue.number+'/attachments',{headers:f.headers})).status).not.toBe(200);
  expect((await create()).status).toBe(410);
  const list=await(await fetch(f.base+'/issues',{headers:f.headers})).json() as {number:number}[];expect(list.some(row=>row.number===issue.number)).toBe(false);
  const filtered=await(await fetch(f.base+'/issues/query?state=all',{headers:f.headers})).json() as {issues:Array<{number:number}>};expect(filtered.issues.some(row=>row.number===issue.number)).toBe(false);expect(JSON.stringify(filtered)).not.toContain(creation.title);
  const graph=await(await fetch(f.base+'/issues/1/relations',{headers:f.headers})).json() as {items:Array<{number:number;issue:unknown;available:boolean}>};expect(graph.items.find(row=>row.number===issue.number)).toMatchObject({issue:null,available:false});expect(JSON.stringify(graph)).not.toContain(creation.title);
  const plan=await(await fetch(f.base+'/planning',{headers:f.headers})).json() as {plan:{project:{items:unknown[]}};inactiveReferences:unknown[]};expect(plan.plan.project.items).toEqual([]);expect(plan.inactiveReferences).toContainEqual({issueNumber:issue.number,available:false});expect(JSON.stringify(plan)).not.toContain(creation.title);
  const ownArchive=await(await fetch(f.base+'/metadata-archive',{headers:f.headers})).json() as {archive:{version:number;tables:Array<{name:string;rows:unknown[]}>}};expect(ownArchive.archive.version).toBe(2);expect(ownArchive.archive.tables.find(table=>table.name==='issue_lifecycle_history')?.rows).toHaveLength(1);expect(JSON.stringify(ownArchive)).toContain(creation.body);
  await fetch(f.origin+'/fixture/history?number='+issue.number);
  const fullHistory=await fetch(f.base+'/metadata-archive/history',{headers:f.headers});expect(fullHistory.status).toBe(200);expect(await fullHistory.text()).toContain('Private owner archival context');
  const readMint=await fetch(f.origin+'/api/tokens',{method:'POST',headers:f.headers,body:JSON.stringify({label:'Owner readonly archive fixture',scope:'read',repo:'p123456789abc',ttlSeconds:60})});expect(readMint.status).toBe(201);const ownerRead=await readMint.json() as {token:string};
  const readArchive=await fetch(f.base+'/metadata-archive',{headers:{...f.headers,Authorization:`Bearer ${ownerRead.token}`}});expect(readArchive.status).toBe(200);const readPayload=await readArchive.text();expect(readPayload).not.toContain(creation.title);expect(readPayload).not.toContain(creation.body);expect(readPayload).not.toContain('Private discussion');expect(readPayload).toContain('historical-unknown');
  const readHistory=await fetch(f.base+'/metadata-archive/history',{headers:{...f.headers,Authorization:`Bearer ${ownerRead.token}`}});expect(readHistory.status).toBe(200);expect(await readHistory.text()).not.toContain('Private owner archival context');
  const memberHistory=await fetch(f.base+'/metadata-archive/history',{headers:{...f.headers,Authorization:`Bearer ${member.secret}`}});expect(memberHistory.status).toBe(200);expect(await memberHistory.text()).not.toContain('Private owner archival context');
  const memberArchive=await fetch(f.base+'/metadata-archive',{headers:{...f.headers,Authorization:`Bearer ${member.secret}`}});expect(memberArchive.status).toBe(200);const redacted=await memberArchive.text();expect(redacted).not.toContain(creation.title);expect(redacted).not.toContain(creation.body);expect(redacted).not.toContain('Private discussion');
  await fetch(f.origin+'/fixture/revoke?id='+f.token.id);expect((await f.remove(issue.number,input)).status).not.toBe(200);
 }finally{await f.mf.dispose();}
},60000);

const revokedName='issue deletion HTTP rechecks owner token after admission before writing tombstone';
test(revokedName,async()=>{
 if(await workerdChild('tests/issue-lifecycle-http.test.ts',revokedName))return;
 const f=await fixture();let pending:Promise<Response>|undefined;
 try{
  await fetch(f.origin+'/fixture/arm');pending=f.remove(1,{expectedRevision:0,requestId:crypto.randomUUID(),confirmed:true});
  const deadline=Date.now()+3000;let paused=false;
  while(Date.now()<deadline){paused=(await(await fetch(f.origin+'/fixture/pause-status')).json() as {paused:boolean}).paused;if(paused)break;await new Promise(resolve=>setTimeout(resolve,10));}
  expect(paused).toBe(true);await fetch(f.origin+'/fixture/revoke?id='+f.token.id);await fetch(f.origin+'/fixture/resume');expect((await pending).status).not.toBe(200);pending=undefined;
  expect((await(await fetch(f.origin+'/fixture/inspect')).json() as {state:string}).state).toBe('open');
 }finally{await fetch(f.origin+'/fixture/resume').catch(()=>undefined);await pending?.catch(()=>undefined);await f.mf.dispose();}
},60000);
