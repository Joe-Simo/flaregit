import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';

type Issue={state:'open'|'closed';stateRevision:number};
type Receipt={issue:Issue;requestId:string;replayed:boolean;changedSince:boolean;originalState:Issue['state'];originalRevision:number};
async function fixture(){
 const file=`/tmp/flaregit-issue-state-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,'build','tests/support/issue-state-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*','--outfile='+file],{stdout:'ignore',stderr:'pipe'});
 try{
  if(await build.exited)throw Error(await new Response(build.stderr).text());
  const script=await Bun.file(file).text();
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'issue-state',unsafeDirectSockets:[{host:'127.0.0.1',port:0}],modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{REPOSITORY_CONTROLLER:{className:'IssueStateFixture',useSQLite:true}},r2Buckets:{EVIDENCE_BUCKET:'issue-state-bytes'}}]}));
  try{
   const origin=(await mf.unsafeGetDirectURL('issue-state')).origin;
   await fetch(origin+'/fixture/seed');
   const token=await(await fetch(origin+'/fixture/token')).json() as {secret:string;id:string};
   const headers={Authorization:`Bearer ${token.secret}`,'CF-Connecting-IP':'192.0.2.49','Content-Type':'application/json'};
   const issueUrl=origin+'/api/p/p123456789abc/issues/1';
   const patch=(input:{state:Issue['state'];expectedRevision:number;requestId:string})=>fetch(issueUrl,{method:'PATCH',headers,body:JSON.stringify(input)});
   const inspect=async()=>await(await fetch(origin+'/fixture/inspect')).json() as Issue;
   return {mf,origin,token,headers,issueUrl,patch,inspect};
  }catch(error){await mf.dispose();throw error;}
 }finally{await Bun.file(file).delete();}
}

const casName='issue state HTTP compare-and-swap preserves original request receipts across later transitions';
test(casName,async()=>{
 if(await workerdChild('tests/issue-state-http.test.ts',casName))return;
 const f=await fixture();
 try{
  const initial=await(await fetch(f.issueUrl,{headers:f.headers})).json() as Issue;
  expect(initial.state).toBe('open');expect(initial.stateRevision).toBe(0);
  for(const input of [{state:'closed'},{state:'closed',expectedRevision:-1,requestId:crypto.randomUUID()},{state:'closed',expectedRevision:0,requestId:'not-a-uuid'}]){
   expect((await fetch(f.issueUrl,{method:'PATCH',headers:f.headers,body:JSON.stringify(input)})).status).toBe(400);
  }
  expect(await f.inspect()).toMatchObject({state:'open',stateRevision:0});
  const first={state:'closed' as const,expectedRevision:0,requestId:crypto.randomUUID()};
  const competing={...first,requestId:crypto.randomUUID()};
  const responses=await Promise.all([f.patch(first),f.patch(competing)]);
  expect(responses.map(response=>response.status).sort()).toEqual([200,409]);
  const winner=responses[0]!.status===200?first:competing;
  const receipt=await responses.find(response=>response.status===200)!.json() as Receipt;
  expect(receipt.issue.state).toBe('closed');expect(receipt.issue.stateRevision).toBe(1);expect(receipt.replayed).toBe(false);
  const replay=await f.patch(winner);expect(replay.status).toBe(200);
  expect((await replay.json() as Receipt).replayed).toBe(true);expect((await f.inspect()).stateRevision).toBe(1);
  expect((await f.patch({...winner,state:'open'})).status).toBe(409);
  const reopen=await f.patch({state:'open',expectedRevision:1,requestId:crypto.randomUUID()});expect(reopen.status).toBe(200);
  const oldRetry=await f.patch(winner);expect(oldRetry.status).toBe(200);
  const oldReceipt=await oldRetry.json() as Receipt;
  expect(oldReceipt.replayed).toBe(true);expect(oldReceipt.changedSince).toBe(true);
  expect(oldReceipt.originalState).toBe('closed');expect(oldReceipt.originalRevision).toBe(1);
  expect(oldReceipt.issue.state).toBe('open');expect(oldReceipt.issue.stateRevision).toBe(2);
  await fetch(f.origin+'/fixture/revoke?id='+f.token.id);
  expect((await f.patch(winner)).status).not.toBe(200);
  expect(await f.inspect()).toMatchObject({state:'open',stateRevision:2});
 }finally{await f.mf.dispose();}
},60000);

for(const revoke of ['token','membership'] as const){
 const fenceName=`issue state HTTP rechecks ${revoke} after canonical admission`;
 test(fenceName,async()=>{
  if(await workerdChild('tests/issue-state-http.test.ts',fenceName))return;
  const f=await fixture();let pending:Promise<Response>|undefined;
  try{
   const member=await(await fetch(f.origin+'/fixture/member-token')).json() as {secret:string;id:string};
   const headers=revoke==='token'?f.headers:{...f.headers,Authorization:`Bearer ${member.secret}`};
   expect((await fetch(f.origin+'/fixture/arm')).status).toBe(200);
   pending=fetch(f.issueUrl,{method:'PATCH',headers,body:JSON.stringify({state:'closed',expectedRevision:0,requestId:crypto.randomUUID()})});
   const deadline=Date.now()+3000;let paused=false;
   while(Date.now()<deadline){paused=(await(await fetch(f.origin+'/fixture/pause-status')).json() as {paused:boolean}).paused;if(paused)break;await new Promise(resolve=>setTimeout(resolve,10));}
   expect(paused).toBe(true);
   const revocation=revoke==='token'?'/fixture/revoke?id='+f.token.id:'/fixture/revoke-member';
   expect((await fetch(f.origin+revocation)).status).toBe(200);
   await fetch(f.origin+'/fixture/resume');
   expect((await pending).status).not.toBe(200);pending=undefined;
   expect(await f.inspect()).toMatchObject({state:'open',stateRevision:0});
  }finally{await fetch(f.origin+'/fixture/resume').catch(()=>undefined);await pending?.catch(()=>undefined);await f.mf.dispose();}
 },60000);
}

const internalName='internal issue close advances HTTP state revision and rejects stale client state';
test(internalName,async()=>{
 if(await workerdChild('tests/issue-state-http.test.ts',internalName))return;
 const f=await fixture();
 try{
  expect((await fetch(f.origin+'/fixture/internal-close')).status).toBe(200);
  expect(await f.inspect()).toMatchObject({state:'closed',stateRevision:1});
  expect((await f.patch({state:'open',expectedRevision:0,requestId:crypto.randomUUID()})).status).toBe(409);
  expect(await f.inspect()).toMatchObject({state:'closed',stateRevision:1});
 }finally{await f.mf.dispose();}
},60000);
