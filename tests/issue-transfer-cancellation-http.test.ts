import {expect,test} from 'bun:test';
import {workerdChild} from './support/workerd-child';
import {createIssueTransferHarness} from './support/issue-transfer-test-harness';
import type {IssueTransferPreview,IssueTransferRequest} from '../src/server/issue-transfer-api';

type Harness=Awaited<ReturnType<typeof createIssueTransferHarness>>;
const file='tests/issue-transfer-cancellation-http.test.ts';
const cancelInput=(input:IssueTransferRequest)=>({requestId:input.requestId,cancelId:crypto.randomUUID(),expectedManifestDigest:input.expectedManifestDigest,expectedDestinationIncarnation:input.expectedDestinationIncarnation,confirmed:true,originalRequest:input});
const start=(h:Harness,input:IssueTransferRequest)=>h.call(h.issuePath()+'/transfer','POST',input);
const cancel=(h:Harness,input:IssueTransferRequest,body:ReturnType<typeof cancelInput>,token=h.admin)=>h.call(h.issuePath()+`/transfer/${input.requestId}/cancel`,'POST',body,token);
async function rawDestination(h:Harness){return await(await h.fixture('authority?target=destination')).json() as {issues:Array<{number:number}>};}
async function firstDestination(h:Harness,stage:string,response?:{status:number;text():Promise<string>}){const detail=response?{status:response.status,body:await response.text()}:null,source=await(await h.fixture('authority?target=source')).json(),destination=await rawDestination(h);expect(destination.issues,JSON.stringify({stage,response:detail,source,destination})).toHaveLength(1);if(detail)await h.noPrivate({text:async()=>detail.body});return destination.issues[0]!.number;}
async function hiddenDestination(h:Harness,number:number){
 const read=await h.call(h.issuePath(h.destination,number));expect([403,404,410]).toContain(read.status);await h.noPrivate(read);
 for(const state of ['open','closed']){const list=await h.call(`/api/p/${h.destination}/issues?state=${state}`);expect(list.status).toBe(200);expect((await list.json() as Array<{number:number}>).some(row=>row.number===number)).toBe(false);}
 const comment=await h.call(`/api/p/${h.destination}/comments?subject=issue:${number}&page=1`);expect([403,404,410]).toContain(comment.status);await h.noPrivate(comment);
 const archive=await h.call(`/api/p/${h.destination}/metadata-archive`);expect(archive.status).toBe(200);const value=await archive.json() as {archive:{tables:Array<{name:string;rows:Array<Record<string,unknown>>}>}};expect(value.archive.tables.find(table=>table.name==='issues')?.rows.some(row=>row.number===number)??false).toBe(false);expect(value.archive.tables.find(table=>table.name==='comments')?.rows.some(row=>row.subject===`issue:${number}`)??false).toBe(false);
 const search=await h.call('/api/search?q=Private%20transferable');expect(search.status).toBe(200);expect((await search.json() as {results:Array<{id:string}>}).results.some(row=>row.id===`${h.destination}:issue:${number}`)).toBe(false);
}
async function preservedSource(h:Harness,binary?:{id:string;bytes:Uint8Array<ArrayBuffer>}){
 const source=await h.call(h.issuePath());expect(source.status).toBe(200);expect(await source.json()).toMatchObject({title:'Private transferable issue secret',body:'Private transferable body secret',comments:[{body:'Private transferable comment secret'}],transferPending:false});
 if(binary){const download=await h.call(h.issuePath()+`/attachments/${binary.id}/content`);expect(download.status).toBe(200);expect(new Uint8Array(await download.arrayBuffer())).toEqual(binary.bytes);}
}
async function cancellationComplete(h:Harness,input:IssueTransferRequest,body:ReturnType<typeof cancelInput>){
 const response=await cancel(h,input,body);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({requestId:input.requestId,cancelId:body.cancelId,cancelled:true,sourceUnlocked:true});
 const again=await cancel(h,input,body);expect(again.status).toBe(200);expect(await again.json()).toMatchObject({requestId:input.requestId,cancelId:body.cancelId,cancelled:true,sourceUnlocked:true,replayed:true});
 const status=await h.call(h.issuePath()+`/transfer/${input.requestId}`);expect(status.status).toBe(200);expect(await status.json()).toMatchObject({phase:'cancelled',cancelled:true,completed:false,cancelId:body.cancelId});
 const obsolete=await start(h,input);expect([403,409,410]).toContain(obsolete.status);await h.noPrivate(obsolete);
}

const lostReservation='signed cancellation resolves unknown reservation with immutable cancel identity and both administrator authority';
test(lostReservation,async()=>{
 if(await workerdChild(file,lostReservation))return;const h=await createIssueTransferHarness();
 try{
  const binary=await h.upload(),input=await h.prepare(),body=cancelInput(input);await h.fixture('lost-ack?target=destination&stage=reservation');const unknown=await start(h,input);expect(unknown.status).not.toBe(200);const number=await firstDestination(h,'reservation acknowledgement loss',unknown);
  for(const token of [h.seed.tokens.read!.secret,h.seed.tokens.pinned!.secret,h.seed.tokens.sourceOnly!.secret,h.seed.tokens.destinationOnly!.secret,h.seed.tokens.member!.secret,h.seed.oauth]){const rejected=await cancel(h,input,body,token);expect([401,403,404]).toContain(rejected.status);await h.noPrivate(rejected);}
  const fullPat=await cancel(h,input,body,h.seed.tokens.admin!.secret);expect(fullPat.status).toBe(200);expect(await fullPat.json()).toMatchObject({cancelled:true,cancelId:body.cancelId,sourceUnlocked:true});await cancellationComplete(h,input,body);await hiddenDestination(h,number);await preservedSource(h,binary);expect((await rawDestination(h)).issues).toHaveLength(1);
  const changed=await cancel(h,input,{...body,cancelId:crypto.randomUUID()});expect(changed.status).toBe(409);
  const source=await(await h.call(h.issuePath())).json() as {stateRevision:number};expect((await h.call(h.issuePath(),'PATCH',{state:'closed',expectedRevision:source.stateRevision,requestId:crypto.randomUUID()})).status).toBe(200);
 }finally{await h.dispose();}
},60000);

const verifiedCopy='cancellation wins over pending activation after real verified copies despite destination audience drift';
test(verifiedCopy,async()=>{
 if(await workerdChild(file,verifiedCopy))return;const h=await createIssueTransferHarness();let pending:Promise<Response>|undefined;
 try{
  const binary=await h.upload(),input=await h.prepare(),body=cancelInput(input);await h.fixture('hook-arm?target=destination&stage=activation');pending=start(h,input);await h.waitPaused('hook','destination');const number=await firstDestination(h,'expected incoming issue reservation');await hiddenDestination(h,number);
  await h.fixture('audience-drift');await cancellationComplete(h,input,body);await h.fixture('hook-resume?target=destination');const late=await pending;pending=undefined;expect(late.status).not.toBe(200);await h.noPrivate(late);await hiddenDestination(h,number);await preservedSource(h,binary);
 }finally{await h.fixture('hook-resume?target=destination').catch(()=>undefined);await pending?.catch(()=>undefined);await h.dispose();}
},60000);

const lateReserve='cancellation fences a reservation callback that was admitted before destination allocation';
test(lateReserve,async()=>{
 if(await workerdChild(file,lateReserve))return;const h=await createIssueTransferHarness();let pending:Promise<Response>|undefined;
 try{
  const input=await h.prepare(),body=cancelInput(input);await h.fixture('hook-arm?target=destination&stage=reservation');pending=start(h,input);await h.waitPaused('hook','destination');expect((await rawDestination(h)).issues).toEqual([]);
  await cancellationComplete(h,input,body);await h.fixture('hook-resume?target=destination');const late=await pending;pending=undefined;expect(late.status).not.toBe(200);await h.noPrivate(late);expect((await rawDestination(h)).issues).toEqual([]);await preservedSource(h);
 }finally{await h.fixture('hook-resume?target=destination').catch(()=>undefined);await pending?.catch(()=>undefined);await h.dispose();}
},60000);

const lateBytes='cancelled destination permanently fences real R2 copy completion after the source is unlocked';
test(lateBytes,async()=>{
 if(await workerdChild(file,lateBytes))return;const h=await createIssueTransferHarness();let pending:Promise<Response>|undefined;
 try{
  const binary=await h.upload(),input=await h.prepare(),body=cancelInput(input);await h.fixture('write-arm?target=destination');pending=start(h,input);await h.waitPaused('write','destination');const number=await firstDestination(h,'expected incoming issue reservation');
  await cancellationComplete(h,input,body);await preservedSource(h,binary);await h.fixture('write-resume?target=destination');const late=await pending;pending=undefined;expect(late.status).not.toBe(200);await h.noPrivate(late);expect(await(await h.fixture('write-status?target=destination')).json()).toMatchObject({completed:true});await hiddenDestination(h,number);await preservedSource(h,binary);
 }finally{await h.fixture('write-resume?target=destination').catch(()=>undefined);await pending?.catch(()=>undefined);await h.dispose();}
},60000);

const activationWinner='administrator cancellation cannot undo an already activated destination and original transfer resumes';
test(activationWinner,async()=>{
 if(await workerdChild(file,activationWinner))return;const h=await createIssueTransferHarness();
 try{
  const binary=await h.upload(),input=await h.prepare(),body=cancelInput(input);await h.fixture('lost-ack?target=destination&stage=activation');const unknown=await start(h,input);expect(unknown.status).not.toBe(200);await h.noPrivate(unknown);const number=await firstDestination(h,'expected incoming issue reservation');
  const copied=await(await h.fixture('put-count?target=destination')).json() as {puts:number};expect(copied.puts).toBeGreaterThan(0);await h.fixture('audience-drift');
  const rejected=await cancel(h,input,body);expect(rejected.status).toBe(409);await h.noPrivate(rejected);const resumed=await start(h,input);expect(resumed.status).toBe(200);expect(await resumed.json()).toMatchObject({requestId:input.requestId,completed:true,destination:{projectId:h.destination,number}});expect((await rawDestination(h)).issues).toHaveLength(1);expect((await h.call(h.issuePath())).status).toBe(410);expect((await h.call(h.issuePath(h.destination,number))).status).toBe(200);expect(await(await h.fixture('put-count?target=destination')).json() as {puts:number}).toEqual(copied);const again=await start(h,input);expect(again.status).toBe(200);expect(await again.json()).toMatchObject({requestId:input.requestId,completed:true,destination:{number}});expect(await(await h.fixture('put-count?target=destination')).json() as {puts:number}).toEqual(copied);const attachments=await(await h.call(h.issuePath(h.destination,number)+'/attachments')).json() as {attachments:Array<{id:string;sha256:string}>};expect(attachments.attachments).toHaveLength(1);expect(attachments.attachments[0]?.sha256).toBe(binary.sha256);
 }finally{await h.dispose();}
},60000);

const cancellationAck='destination cancellation acknowledgement loss preserves the source lock until exact positive readback';
test(cancellationAck,async()=>{
 if(await workerdChild(file,cancellationAck))return;const h=await createIssueTransferHarness();
 try{
  const binary=await h.upload(),input=await h.prepare(),body=cancelInput(input);await h.fixture('lost-ack?target=destination&stage=reservation');expect((await start(h,input)).status).not.toBe(200);const number=await firstDestination(h,'expected incoming issue reservation');
  await h.fixture('cancel-lost-ack?target=destination&stage=destination');const unknown=await cancel(h,input,body);expect(unknown.status).not.toBe(200);await h.noPrivate(unknown);await hiddenDestination(h,number);
  const locked=await h.call(h.issuePath());expect(locked.status).toBe(200);const before=await locked.json() as {transferPending:boolean;stateRevision:number};expect(before.transferPending).toBe(true);expect([403,409]).toContain((await h.call(h.issuePath(),'PATCH',{state:'closed',expectedRevision:before.stateRevision,requestId:crypto.randomUUID()})).status);
  await cancellationComplete(h,input,body);await preservedSource(h,binary);expect((await rawDestination(h)).issues).toHaveLength(1);
 }finally{await h.dispose();}
},60000);

const sourceAck='source cancellation unlock acknowledgement loss remains recoverable with the original cancellation UUID';
test(sourceAck,async()=>{
 if(await workerdChild(file,sourceAck))return;const h=await createIssueTransferHarness();
 try{
  const input=await h.prepare(),body=cancelInput(input);await h.fixture('lost-ack?target=destination&stage=reservation');expect((await start(h,input)).status).not.toBe(200);const number=await firstDestination(h,'expected incoming issue reservation');
  await h.fixture('cancel-lost-ack?target=source&stage=source');const unknown=await cancel(h,input,body);expect(unknown.status).not.toBe(200);await h.noPrivate(unknown);await preservedSource(h);await cancellationComplete(h,input,body);await hiddenDestination(h,number);expect((await rawDestination(h)).issues).toHaveLength(1);
 }finally{await h.dispose();}
},60000);

const retransfer='cancelling an outgoing transfer preserves an incoming issue origin and subsequent native edits';
test(retransfer,async()=>{
 if(await workerdChild(file,retransfer))return;const h=await createIssueTransferHarness();
 try{
  const original=await h.prepare(),moved=await start(h,original);expect(moved.status).toBe(200);const first=await moved.json() as {destination:{number:number}};const number=first.destination.number,path=h.issuePath(h.destination,number);
  const beforeResponse=await h.call(path);expect(beforeResponse.status).toBe(200);const before=await beforeResponse.json() as {transferOrigin:unknown};
  const features=await(await h.call(`/api/p/${h.destination}/issue-features`)).json() as {revision:number};const edited=await h.call(`/api/p/${h.destination}/issue-features`,'PATCH',{expectedRevision:features.revision,action:{kind:'bulk-label',numbers:[number],label:'Native edit after arrival'}});expect(edited.status).toBe(200);
  const previewResponse=await h.call(path+`/transfer-preview?destinationProjectId=${h.source}`);expect(previewResponse.status).toBe(200);const preview=await previewResponse.json() as IssueTransferPreview;
  const outgoing:IssueTransferRequest={destinationProjectId:h.source,expectedRevision:preview.source.stateRevision,requestId:crypto.randomUUID(),confirmed:true,expectedManifestDigest:preview.manifestDigest,expectedDestinationIncarnation:preview.destination.incarnation};
  await h.fixture('lost-ack?target=source&stage=reservation');expect((await h.call(path+'/transfer','POST',outgoing)).status).not.toBe(200);
  const body=cancelInput(outgoing),cancelled=await h.call(path+`/transfer/${outgoing.requestId}/cancel`,'POST',body);expect(cancelled.status).toBe(200);expect(await cancelled.json()).toMatchObject({cancelled:true,sourceUnlocked:true});
  const afterResponse=await h.call(path);expect(afterResponse.status).toBe(200);const after=await afterResponse.json() as {transferOrigin:unknown;transferPending:boolean};expect(after.transferOrigin).toEqual(before.transferOrigin);expect(after.transferPending).toBe(false);
  const native=await(await h.call(`/api/p/${h.destination}/issue-features`)).json() as {triage:Record<string,{labels:string[]}>};expect(native.triage[String(number)]?.labels).toContain('Native edit after arrival');
 }finally{await h.dispose();}
},60000);

const replacement='replacement administrators can cancel a revoked operator transfer without receiving the original execution grant';
test(replacement,async()=>{
 if(await workerdChild(file,replacement))return;const h=await createIssueTransferHarness();
 try{
  const binary=await h.upload(),input=await h.prepare();await h.fixture('lost-ack?target=destination&stage=reservation');const unknown=await start(h,input);expect(unknown.status).not.toBe(200);const number=await firstDestination(h,'replacement administrator recovery',unknown);
  await h.fixture('replacement-admin');await h.fixture('revoke?target=source');const replacementToken=await h.sign('replacement-admin');
  const old=await start(h,input);expect([403,404]).toContain(old.status);await h.noPrivate(old);
  const memberView=await h.call(h.issuePath(),'GET',undefined,h.seed.tokens.member!.secret);expect(memberView.status).toBe(200);const memberBody=await memberView.text();expect(JSON.parse(memberBody)).toMatchObject({transferPending:true});expect(memberBody).not.toContain('pendingTransfer');expect(memberBody).not.toContain(h.destination);expect(memberBody).not.toContain(input.expectedManifestDigest);
  const current=await h.call(h.issuePath(),'GET',undefined,replacementToken);expect(current.status).toBe(200);const issue=await current.json() as {pendingTransfer:{originalRequest:IssueTransferRequest;canResumeOriginal:boolean;canCancel:boolean}};expect(issue.pendingTransfer).toMatchObject({originalRequest:input,canResumeOriginal:false,canCancel:true});
  const body=cancelInput(issue.pendingTransfer.originalRequest),response=await cancel(h,input,body,replacementToken);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({requestId:input.requestId,cancelId:body.cancelId,cancelled:true,sourceUnlocked:true});
  expect(await(await h.fixture(`cancellation-audit?target=source&request=${input.requestId}`)).json() as {actorId:string;cancelId:string;phase:string;originalActorId:string}).toEqual({actorId:'replacement-admin',cancelId:body.cancelId,phase:'cancelled',originalActorId:'transfer-admin'});
  const restored=await h.call(h.issuePath(),'GET',undefined,replacementToken);expect(restored.status).toBe(200);expect(await restored.json()).toMatchObject({title:'Private transferable issue secret',transferPending:false});
  const bytes=await h.call(h.issuePath()+`/attachments/${binary.id}/content`,'GET',undefined,replacementToken);expect(bytes.status).toBe(200);expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(binary.bytes);
  await hiddenDestination(h,number);const oldResume=await start(h,input);expect([403,404]).toContain(oldResume.status);await h.noPrivate(oldResume);expect((await rawDestination(h)).issues).toHaveLength(1);
 }finally{await h.dispose();}
},60000);

const lateSourceRead='cancellation fences a source byte read that was admitted before the destination was withdrawn';
test(lateSourceRead,async()=>{
 if(await workerdChild(file,lateSourceRead))return;const h=await createIssueTransferHarness();let pending:Promise<Response>|undefined;
 try{
  const binary=await h.upload(),input=await h.prepare(),body=cancelInput(input);await h.fixture('read-arm?target=source');pending=start(h,input);await h.waitPaused('read','source');const number=await firstDestination(h,'source read before cancellation');
  await cancellationComplete(h,input,body);await hiddenDestination(h,number);await preservedSource(h,binary);
  await h.fixture('read-resume?target=source');const late=await pending;pending=undefined;expect(late.status).not.toBe(200);await h.noPrivate(late);await hiddenDestination(h,number);await preservedSource(h,binary);expect((await rawDestination(h)).issues).toHaveLength(1);
 }finally{await h.fixture('read-resume?target=source').catch(()=>undefined);await pending?.catch(()=>undefined);await h.dispose();}
},60000);

const staleUnfrozen='cancellation permanently fences a stale original request that never froze an issue';
test(staleUnfrozen,async()=>{
 if(await workerdChild(file,staleUnfrozen))return;const h=await createIssueTransferHarness();
 try{
  const input=await h.prepare(),body=cancelInput(input),newComment='New native comment after transfer confirmation';
  const changed=await h.call(`/api/p/${h.source}/comments`,'POST',{subject:`issue:${h.seed.issue.number}`,body:newComment,idempotencyKey:crypto.randomUUID()});expect(changed.status).toBe(201);
  const stale=await start(h,input);expect(stale.status).toBe(409);await h.noPrivate(stale);expect((await rawDestination(h)).issues).toEqual([]);
  await h.fixture('cancel-lost-ack?target=source&stage=source');const unknown=await cancel(h,input,body);expect(unknown.status).not.toBe(200);await h.noPrivate(unknown);
  const active=await h.call(h.issuePath());expect(active.status).toBe(200);const current=await active.json() as {stateRevision:number;comments:Array<{body:string}>;transferPending:boolean};expect(current.transferPending).toBe(false);expect(current.comments.some(row=>row.body===newComment)).toBe(true);
  const resumed=await cancel(h,input,body);expect(resumed.status).toBe(200);expect(await resumed.json()).toMatchObject({requestId:input.requestId,cancelId:body.cancelId,cancelled:true,sourceUnlocked:true,replayed:true});
  const status=await h.call(h.issuePath()+`/transfer/${input.requestId}`);expect(status.status).toBe(200);expect(await status.json()).toMatchObject({phase:'cancelled',completed:false,cancelled:true,cancelId:body.cancelId});
  const obsolete=await start(h,input);expect([409,410]).toContain(obsolete.status);await h.noPrivate(obsolete);expect((await rawDestination(h)).issues).toEqual([]);
  const malicious=await cancel(h,input,{...body,originalRequest:{...input,expectedRevision:input.expectedRevision+1}});expect(malicious.status).toBe(409);
  expect((await h.call(h.issuePath(),'PATCH',{state:'closed',expectedRevision:current.stateRevision,requestId:crypto.randomUUID()})).status).toBe(200);
 }finally{await h.dispose();}
},60000);

const lateUnfrozen='cancellation of an unfrozen request stops its earlier paused runner before source lock or destination allocation';
test(lateUnfrozen,async()=>{
 if(await workerdChild(file,lateUnfrozen))return;const h=await createIssueTransferHarness();let pending:Promise<Response>|undefined;
 try{
  const binary=await h.upload(),input=await h.prepare(),body=cancelInput(input);await h.fixture('hook-arm?target=source&stage=freeze');pending=start(h,input);await h.waitPaused('hook','source');expect((await rawDestination(h)).issues).toEqual([]);
  const response=await cancel(h,input,body);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({requestId:input.requestId,cancelId:body.cancelId,cancelled:true,sourceUnlocked:true});await preservedSource(h,binary);
  await h.fixture('hook-resume?target=source');const late=await pending;pending=undefined;expect([409,410]).toContain(late.status);await h.noPrivate(late);expect((await rawDestination(h)).issues).toEqual([]);
  const writes=await h.fixture('put-count?target=destination');expect(await writes.json() as {puts:number}).toEqual({puts:0});
  const replay=await cancel(h,input,body);expect(replay.status).toBe(200);expect(await replay.json()).toMatchObject({cancelId:body.cancelId,cancelled:true,replayed:true});await preservedSource(h,binary);
  const altered=await cancel(h,input,{...body,originalRequest:{...input,destinationProjectId:h.source}});expect(altered.status).toBe(409);
 }finally{await h.fixture('hook-resume?target=source').catch(()=>undefined);await pending?.catch(()=>undefined);await h.dispose();}
},60000);

const terminalReceipt='regranted original operators can inspect replacement cancellation without replaying it or clearing a newer pending intent';
test(terminalReceipt,async()=>{
 if(await workerdChild(file,terminalReceipt))return;const h=await createIssueTransferHarness();let pending:Promise<Response>|undefined;
 try{
  const binary=await h.upload(),original=await h.prepare(),body=cancelInput(original);await h.fixture('hook-arm?target=destination&stage=activation');pending=start(h,original);await h.waitPaused('hook','destination');const cancelledNumber=await firstDestination(h,'copied original intent awaiting activation');
  await h.fixture('replacement-admin');await h.fixture('revoke?target=source');const replacementToken=await h.sign('replacement-admin');
  const result=await cancel(h,original,body,replacementToken);expect(result.status).toBe(200);expect(await result.json()).toMatchObject({requestId:original.requestId,cancelId:body.cancelId,cancelled:true,sourceUnlocked:true});
  await h.fixture('hook-resume?target=destination');const stale=await pending;pending=undefined;expect(stale.status).not.toBe(200);await h.noPrivate(stale);await h.fixture('regrant?target=source');
  const mutationSnapshot=await(await h.fixture('storage-count?target=destination')).json() as {puts:number;deletes:number};expect(mutationSnapshot.puts).toBeGreaterThan(0);
  const statusPath=h.issuePath()+`/transfer/${original.requestId}`;
  const receipt=await h.call(statusPath);expect(receipt.status).toBe(200);const observed=await receipt.json() as {phase:string;completed:boolean;cancelled:boolean;cancelId:string;cancellationReceipt:{requestId:string;cancelId:string;cancelled:boolean;sourceUnlocked:boolean;physicalCleanup:string;canReplayCancellation:boolean}};
  expect(observed).toMatchObject({phase:'cancelled',completed:false,cancelled:true,cancelId:body.cancelId,cancellationReceipt:{requestId:original.requestId,cancelId:body.cancelId,cancelled:true,sourceUnlocked:true,canReplayCancellation:false}});expect(['pending','confirmed']).toContain(observed.cancellationReceipt.physicalCleanup);
  expect(await(await h.fixture('storage-count?target=destination')).json() as {puts:number;deletes:number}).toEqual(mutationSnapshot);
  for(const token of [h.seed.tokens.member!.secret,h.seed.tokens.pinned!.secret,h.seed.tokens.read!.secret]){const denied=await h.call(statusPath,'GET',undefined,token);expect([401,403,404]).toContain(denied.status);await h.noPrivate(denied);}
  const wrongActor=await cancel(h,original,body);expect(wrongActor.status).toBe(409);await h.noPrivate(wrongActor);const obsolete=await start(h,original);expect([409,410]).toContain(obsolete.status);await h.noPrivate(obsolete);await preservedSource(h,binary);await hiddenDestination(h,cancelledNumber);
  const active=await(await h.call(h.issuePath())).json() as {stateRevision:number};expect((await h.call(h.issuePath(),'PATCH',{state:'closed',expectedRevision:active.stateRevision,requestId:crypto.randomUUID()})).status).toBe(200);

  const next=await h.prepare();expect(next.requestId).not.toBe(original.requestId);await h.fixture('lost-ack?target=destination&stage=reservation');const unknown=await start(h,next);expect(unknown.status).not.toBe(200);await h.noPrivate(unknown);
  const newer=await h.call(h.issuePath());expect(newer.status).toBe(200);expect(await newer.json()).toMatchObject({transferPending:true,pendingTransfer:{originalRequest:next,canResumeOriginal:true}});
  const oldStatus=await h.call(statusPath);expect(oldStatus.status).toBe(200);expect(await oldStatus.json()).toMatchObject({phase:'cancelled',cancelled:true,cancellationReceipt:{sourceUnlocked:true,canReplayCancellation:false,cancelId:body.cancelId}});
  const stillNew=await h.call(h.issuePath());expect(stillNew.status).toBe(200);expect(await stillNew.json()).toMatchObject({transferPending:true,pendingTransfer:{originalRequest:next}});
  expect((await rawDestination(h)).issues).toHaveLength(2);await hiddenDestination(h,(await rawDestination(h)).issues.at(-1)!.number);
 }finally{await h.fixture('hook-resume?target=destination').catch(()=>undefined);await pending?.catch(()=>undefined);await h.dispose();}
},60000);
