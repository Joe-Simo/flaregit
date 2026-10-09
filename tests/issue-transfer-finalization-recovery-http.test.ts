import {expect,test} from 'bun:test';
import {workerdChild} from './support/workerd-child';
import {createIssueTransferHarness} from './support/issue-transfer-test-harness';
import type {IssueTransferRequest} from '../src/server/issue-transfer-api';

type Harness=Awaited<ReturnType<typeof createIssueTransferHarness>>;
const file='tests/issue-transfer-finalization-recovery-http.test.ts';
const finalization=(input:IssueTransferRequest,number:number)=>({requestId:input.requestId,finalizeId:crypto.randomUUID(),expectedManifestDigest:input.expectedManifestDigest,expectedDestinationIncarnation:input.expectedDestinationIncarnation,destinationNumber:number,confirmed:true});
const finish=(h:Harness,input:IssueTransferRequest,body:ReturnType<typeof finalization>,token:string)=>h.call(h.issuePath()+`/transfer/${input.requestId}/finalize`,'POST',body,token);
async function authority(h:Harness,target:string){return await(await h.fixture('authority?target='+target)).json() as {issues:Array<{number:number}>;tasks:string[];writers:Array<{task_id:string;user_id:string}>;members:Array<{user_id:string;role:string}>;preferences:Array<{actor_id:string;subject:string}>;transfers:Array<{requestId:string;phase:string}>};}
function grants(value:Awaited<ReturnType<typeof authority>>){return{members:value.members,writers:value.writers,tasks:value.tasks,preferences:value.preferences};}
async function active(h:Harness){const binary=await h.upload(),input=await h.prepare();await h.fixture('lost-ack?target=destination&stage=activation');const response=await h.call(h.issuePath()+'/transfer','POST',input);expect(response.status).not.toBe(200);await h.noPrivate(response);const rows=(await authority(h,'destination')).issues;expect(rows).toHaveLength(1);return{input,binary,number:rows[0]!.number};}
async function replacement(h:Harness){await h.fixture('replacement-admin');return await h.sign('replacement-admin');}
async function completed(h:Harness,input:IssueTransferRequest,body:ReturnType<typeof finalization>,token:string){const response=await finish(h,input,body,token);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({requestId:input.requestId,completed:true,destination:{projectId:h.destination,number:body.destinationNumber},finalization:{finalizeId:body.finalizeId,actorId:'replacement-admin',completed:true}});const retry=await finish(h,input,body,token);expect(retry.status).toBe(200);expect(await retry.json()).toMatchObject({completed:true,finalization:{finalizeId:body.finalizeId,actorId:'replacement-admin',replayed:true}});}
async function audit(h:Harness,requestId:string){return await(await h.fixture('finalization-audit?target=source&request='+requestId)).json() as Array<{actorId:string;finalizeId:string;phase:string;originalActorId:string}>;}
async function storage(h:Harness){return await(await h.fixture('storage-count?target=destination')).json() as {puts:number;deletes:number};}

const deletedCreator='replacement administrator finalizes an active transfer after creator deletion without changing attribution or copying bytes';
test(deletedCreator,async()=>{
 if(await workerdChild(file,deletedCreator))return;const h=await createIssueTransferHarness();
 try{
  const {input,number,binary}=await active(h),body=finalization(input,number),before=await(await h.call(h.issuePath(h.destination,number))).json() as {author:string;created_at:string;transferOrigin:unknown;comments:Array<{author:string;body:string}>};
  for(const token of [h.seed.tokens.read!.secret,h.seed.tokens.pinned!.secret,h.seed.tokens.sourceOnly!.secret,h.seed.tokens.destinationOnly!.secret,h.seed.tokens.member!.secret,h.seed.oauth]){const denied=await finish(h,input,body,token);expect([401,403,404]).toContain(denied.status);await h.noPrivate(denied);}
  const replacementToken=await replacement(h);await h.fixture('revoke?target=source');await h.fixture('revoke?target=destination');await h.fixture('delete-original-account');
  const pending=await h.call(h.issuePath(),'GET',undefined,replacementToken);expect(pending.status).toBe(200);expect(await pending.json()).toMatchObject({pendingTransfer:{canResumeOriginal:false,canFinalizeActive:true,activeDestinationNumber:number}});
  const mutated=await finish(h,input,{...body,expectedManifestDigest:'0'.repeat(64)},replacementToken);expect([400,409]).toContain(mutated.status);const wrongNumber=await finish(h,input,{...body,destinationNumber:number+1},replacementToken);expect([404,409]).toContain(wrongNumber.status);
  const sourceAuthority=await authority(h,'source'),destinationAuthority=await authority(h,'destination'),counts=await storage(h);expect(counts.puts).toBeGreaterThan(0);const replacementPat=await(await h.fixture('replacement-token')).json() as {secret:string;id:string};
  await completed(h,input,body,replacementPat.secret);const sessionReplay=await finish(h,input,body,replacementToken);expect(sessionReplay.status).toBe(200);expect(await sessionReplay.json()).toMatchObject({finalization:{actorId:'replacement-admin',finalizeId:body.finalizeId,replayed:true}});expect(await storage(h)).toEqual(counts);const afterSourceAuthority=await authority(h,'source'),afterDestinationAuthority=await authority(h,'destination');expect(grants(afterSourceAuthority)).toEqual(grants(sourceAuthority));expect(grants(afterDestinationAuthority)).toEqual(grants(destinationAuthority));expect(afterSourceAuthority.issues).toEqual(sourceAuthority.issues);expect(afterDestinationAuthority.issues).toEqual(destinationAuthority.issues);expect(afterSourceAuthority.transfers.find(row=>row.requestId===input.requestId)?.phase).toBe('completed');
  const after=await(await h.call(h.issuePath(h.destination,number),'GET',undefined,replacementToken)).json() as typeof before;expect(after.author).toBe(before.author);expect(after.created_at).toBe(before.created_at);expect(after.transferOrigin).toEqual(before.transferOrigin);expect(after.comments.map(row=>({author:row.author,body:row.body}))).toEqual(before.comments.map(row=>({author:row.author,body:row.body})));
  expect(await audit(h,input.requestId)).toEqual([{actorId:'replacement-admin',finalizeId:body.finalizeId,phase:'completed',originalActorId:'transfer-admin'}]);const gone=await h.call(h.issuePath(),'GET',undefined,replacementToken);expect(gone.status).toBe(410);await h.noPrivate(gone);
  const files=await(await h.call(h.issuePath(h.destination,number)+'/attachments','GET',undefined,replacementToken)).json() as {attachments:Array<{id:string;sha256:string}>};expect(files.attachments).toHaveLength(1);expect(files.attachments[0]?.sha256).toBe(binary.sha256);const download=await h.call(h.issuePath(h.destination,number)+`/attachments/${files.attachments[0]!.id}/content`,'GET',undefined,replacementToken);expect(download.status).toBe(200);expect(new Uint8Array(await download.arrayBuffer())).toEqual(binary.bytes);
 }finally{await h.dispose();}
},60000);

const preactive='replacement finalization cannot activate a reserved transfer or acquire publication permission';
test(preactive,async()=>{
 if(await workerdChild(file,preactive))return;const h=await createIssueTransferHarness();
 try{
  const input=await h.prepare();await h.fixture('lost-ack?target=destination&stage=reservation');expect((await h.call(h.issuePath()+'/transfer','POST',input)).status).not.toBe(200);const number=(await authority(h,'destination')).issues[0]!.number,token=await replacement(h),body=finalization(input,number),counts=await storage(h);
  const pending=await h.call(h.issuePath(),'GET',undefined,token);expect(pending.status).toBe(200);expect(await pending.json()).toMatchObject({pendingTransfer:{canFinalizeActive:false}});
  const denied=await finish(h,input,body,token);expect([404,409]).toContain(denied.status);await h.noPrivate(denied);expect(await storage(h)).toEqual(counts);expect((await authority(h,'destination')).issues).toHaveLength(1);
  const hidden=await h.call(h.issuePath(h.destination,number),'GET',undefined,token);expect([403,404,410]).toContain(hidden.status);await h.noPrivate(hidden);const source=await h.call(h.issuePath(),'GET',undefined,token);expect(source.status).toBe(200);expect(await source.json()).toMatchObject({title:'Private transferable issue secret',transferPending:true});
 }finally{await h.dispose();}
},60000);

for(const [name,kind] of [['source completion acknowledgement loss resumes replacement finalization with its original UUID','source'],['destination unlock acknowledgement loss resumes replacement finalization without duplicate bytes','destination']] as const){
 test(name,async()=>{
  if(await workerdChild(file,name))return;const h=await createIssueTransferHarness();
  try{
   const {input,number}=await active(h),token=await replacement(h),body=finalization(input,number),counts=await storage(h);await h.fixture('revoke?target=source');
   await h.fixture(kind==='source'?'finalization-ack?target=source&stage=source':'lost-ack?target=destination&stage=finalization');const unknown=await finish(h,input,body,token);expect(unknown.status).not.toBe(200);await h.noPrivate(unknown);expect(await storage(h)).toEqual(counts);
   const read=await h.call(h.issuePath(),'GET',undefined,token);expect(read.status).toBe(410);await h.noPrivate(read);await completed(h,input,body,token);expect(await storage(h)).toEqual(counts);expect((await authority(h,'destination')).issues).toHaveLength(1);expect(await audit(h,input.requestId)).toEqual([{actorId:'replacement-admin',finalizeId:body.finalizeId,phase:'completed',originalActorId:'transfer-admin'}]);
   const altered=await finish(h,input,{...body,destinationNumber:number+1},token);expect([404,409]).toContain(altered.status);
  }finally{await h.dispose();}
 },60000);
}

const finisherRevoke='replacement finalization rechecks its current administrator epoch after an awaited inspection';
test(finisherRevoke,async()=>{
 if(await workerdChild(file,finisherRevoke))return;const h=await createIssueTransferHarness();let pending:Promise<Response>|undefined;
 try{
  const {input,number}=await active(h),token=await replacement(h),body=finalization(input,number),counts=await storage(h);await h.fixture('revoke?target=source');await h.fixture('finalization-arm?target=source');pending=finish(h,input,body,token);await h.waitPaused('finalization','source');await h.fixture('revoke-replacement?target=source');await h.fixture('finalization-resume?target=source');const denied=await pending;pending=undefined;expect([401,403]).toContain(denied.status);await h.noPrivate(denied);expect(await storage(h)).toEqual(counts);
  const originalSource=await h.call(h.issuePath(),'GET',undefined,h.seed.tokens.sourceOnly!.secret);expect(originalSource.status).toBe(200);expect(await originalSource.json()).toMatchObject({title:'Private transferable issue secret',transferPending:true});
  await h.fixture('replacement-admin');await completed(h,input,body,token);expect(await storage(h)).toEqual(counts);expect((await authority(h,'destination')).issues).toHaveLength(1);
 }finally{await h.fixture('finalization-resume?target=source').catch(()=>undefined);await pending?.catch(()=>undefined);await h.dispose();}
},60000);

const activeCancellation='a different administrator finishes the winning activation without impersonating the pending cancellation actor';
test(activeCancellation,async()=>{
 if(await workerdChild(file,activeCancellation))return;const h=await createIssueTransferHarness();
 try{
  const {input,number}=await active(h),cancelToken=await replacement(h),cancelId=crypto.randomUUID();
  await h.fixture('active-cancel-ack?target=destination');
  const refusal=await h.call(h.issuePath()+`/transfer/${input.requestId}/cancel`,'POST',{requestId:input.requestId,cancelId,expectedManifestDigest:input.expectedManifestDigest,expectedDestinationIncarnation:input.expectedDestinationIncarnation,confirmed:true,originalRequest:input},cancelToken);expect(refusal.status).toBe(503);await h.noPrivate(refusal);expect(await(await h.fixture(`cancellation-audit?target=source&request=${input.requestId}`)).json()).toMatchObject({actorId:'replacement-admin',phase:'cancelling',cancelId});
  await h.fixture('finisher-admin');await h.fixture('revoke?target=source');const finisherToken=await h.sign('finisher-admin'),body=finalization(input,number),counts=await storage(h),done=await finish(h,input,body,finisherToken);expect(done.status).toBe(200);expect(await done.json()).toMatchObject({completed:true,destination:{number},finalization:{finalizeId:body.finalizeId,actorId:'finisher-admin',completed:true}});expect(await storage(h)).toEqual(counts);
  expect(await audit(h,input.requestId)).toEqual([{actorId:'finisher-admin',finalizeId:body.finalizeId,phase:'completed',originalActorId:'transfer-admin'}]);expect(await(await h.fixture(`cancellation-audit?target=source&request=${input.requestId}`)).json() as {actorId:string;cancelId:string;phase:string;originalActorId:string}).toEqual({actorId:'replacement-admin',cancelId,phase:'denied-active',originalActorId:'transfer-admin'});
 }finally{await h.dispose();}
},60000);

const editedAfterUnlock='recovery acknowledgement loss reconciles immutable completed receipts while preserving subsequent destination edits';
test(editedAfterUnlock,async()=>{
 if(await workerdChild(file,editedAfterUnlock))return;const h=await createIssueTransferHarness();
 try{
  const {input,number}=await active(h),token=await replacement(h),body=finalization(input,number);await h.fixture('revoke?target=source');await h.fixture('lost-ack?target=destination&stage=finalization');const unknown=await finish(h,input,body,token);expect(unknown.status).not.toBe(200);await h.noPrivate(unknown);
  const path=h.issuePath(h.destination,number),initial=await(await h.call(path,'GET',undefined,token)).json() as {stateRevision:number;transferOrigin:unknown};
  const closed=await h.call(path,'PATCH',{state:'closed',expectedRevision:initial.stateRevision,requestId:crypto.randomUUID()},token);expect(closed.status).toBe(200);
  const comment='Legitimate destination edit after durable finalization';expect((await h.call(`/api/p/${h.destination}/comments`,'POST',{subject:`issue:${number}`,body:comment,idempotencyKey:crypto.randomUUID()},token)).status).toBe(201);
  const features=await(await h.call(`/api/p/${h.destination}/issue-features`,'GET',undefined,token)).json() as {revision:number};expect((await h.call(`/api/p/${h.destination}/issue-features`,'PATCH',{expectedRevision:features.revision,action:{kind:'bulk-label',numbers:[number],label:'Native finalized edit'}},token)).status).toBe(200);
  const before=await(await h.call(path,'GET',undefined,token)).json() as {state:string;stateRevision:number;comments:Array<{id:number;body:string}>;transferOrigin:unknown},counts=await storage(h);
  await completed(h,input,body,token);expect(await storage(h)).toEqual(counts);const after=await(await h.call(path,'GET',undefined,token)).json() as typeof before;expect(after.state).toBe('closed');expect(after.stateRevision).toBe(before.stateRevision);expect(after.comments).toEqual(before.comments);expect(after.comments.some(row=>row.body===comment)).toBe(true);expect(after.transferOrigin).toEqual(initial.transferOrigin);
  const preservedFeatures=await(await h.call(`/api/p/${h.destination}/issue-features`,'GET',undefined,token)).json() as {triage:Record<string,{labels:string[]}>};expect(preservedFeatures.triage[String(number)]?.labels).toContain('Native finalized edit');expect((await authority(h,'destination')).issues).toHaveLength(1);
  expect(await(await h.fixture(`actual-finalization-actors?target=source&request=${input.requestId}&number=${h.seed.issue.number}`)).json()).toMatchObject({sourceActorId:'replacement-admin',sourceRecovery:{actorId:'replacement-admin',finalizeId:body.finalizeId}});
  expect(await(await h.fixture(`actual-finalization-actors?target=destination&request=${input.requestId}&number=${number}`)).json()).toMatchObject({destinationFinalization:{actorId:'replacement-admin',finalizeId:body.finalizeId}});
 }finally{await h.dispose();}
},60000);

const originalWins='a recovery requester observes the original runner finalization without replacing the actual source or destination actor';
test(originalWins,async()=>{
 if(await workerdChild(file,originalWins))return;const h=await createIssueTransferHarness();let pending:Promise<Response>|undefined;
 try{
  const {input,number}=await active(h),token=await replacement(h),body=finalization(input,number),counts=await storage(h);await h.fixture('finalization-arm?target=source');pending=finish(h,input,body,token);await h.waitPaused('finalization','source');
  const winner=await h.call(h.issuePath()+'/transfer','POST',input);expect(winner.status).toBe(200);expect(await winner.json()).toMatchObject({completed:true,destination:{number}});const afterWinnerCounts=await storage(h);expect(afterWinnerCounts.puts).toBe(counts.puts);await h.fixture('finalization-resume?target=source');const observed=await pending;pending=undefined;expect(observed.status).toBe(200);expect(await observed.json()).toMatchObject({completed:true,finalization:{actorId:'replacement-admin',finalizeId:body.finalizeId}});expect(await storage(h)).toEqual(afterWinnerCounts);
  expect(await(await h.fixture(`actual-finalization-actors?target=source&request=${input.requestId}&number=${h.seed.issue.number}`)).json()).toMatchObject({sourceActorId:'transfer-admin',sourceRecovery:null});
  expect(await(await h.fixture(`actual-finalization-actors?target=destination&request=${input.requestId}&number=${number}`)).json()).toMatchObject({destinationFinalization:{actorId:'transfer-admin'}});
  await completed(h,input,body,token);expect(await storage(h)).toEqual(afterWinnerCounts);expect((await authority(h,'destination')).issues).toHaveLength(1);expect(await audit(h,input.requestId)).toEqual([{actorId:'replacement-admin',finalizeId:body.finalizeId,phase:'completed',originalActorId:'transfer-admin'}]);
 }finally{await h.fixture('finalization-resume?target=source').catch(()=>undefined);await pending?.catch(()=>undefined);await h.dispose();}
},60000);

const destinationEpoch='replacement finalization rejects a renewed destination administrator epoch after its initial readback';
test(destinationEpoch,async()=>{
 if(await workerdChild(file,destinationEpoch))return;const h=await createIssueTransferHarness();let pending:Promise<Response>|undefined;
 try{
  const {input,number}=await active(h),token=await replacement(h),body=finalization(input,number),counts=await storage(h);await h.fixture('revoke?target=source');await h.fixture('finalization-arm?target=source');pending=finish(h,input,body,token);await h.waitPaused('finalization','source');
  await h.fixture('revoke-replacement?target=destination');await h.fixture('replacement-admin');await h.fixture('finalization-resume?target=source');const oldGrant=await pending;pending=undefined;expect(oldGrant.status).toBe(403);await h.noPrivate(oldGrant);expect(await storage(h)).toEqual(counts);
  const source=await h.call(h.issuePath(),'GET',undefined,token);expect(source.status).toBe(200);expect(await source.json()).toMatchObject({title:'Private transferable issue secret',transferPending:true});const destination=await h.call(h.issuePath(h.destination,number),'GET',undefined,token);expect(destination.status).toBe(200);const issue=await destination.json() as {stateRevision:number};
  const locked=await h.call(h.issuePath(h.destination,number),'PATCH',{state:'closed',expectedRevision:issue.stateRevision,requestId:crypto.randomUUID()},token);expect([403,409]).toContain(locked.status);
  await completed(h,input,body,token);expect(await storage(h)).toEqual(counts);expect((await authority(h,'destination')).issues).toHaveLength(1);expect(await audit(h,input.requestId)).toEqual([{actorId:'replacement-admin',finalizeId:body.finalizeId,phase:'completed',originalActorId:'transfer-admin'}]);
 }finally{await h.fixture('finalization-resume?target=source').catch(()=>undefined);await pending?.catch(()=>undefined);await h.dispose();}
},60000);
