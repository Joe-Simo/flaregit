import {expect,test} from 'bun:test';
import {workerdChild} from './support/workerd-child';
import {createIssueTransferHarness} from './support/issue-transfer-test-harness';
import {checkedMappingPreview,createMappingRequest,type TransferMappingPreview} from '../src/web/issue-transfer-mapping-intent';
import type {IssueFeatureWrite,IssueTransferMapping} from '../src/server/issue-feature-store';

type Harness=Awaited<ReturnType<typeof createIssueTransferHarness>>;
const file='tests/issue-transfer-mapping-http.test.ts';
type Features={revision:number;milestones:Array<{id:number;title:string}>;triage:Record<string,{labels:string[];assignees:string[];milestone?:number}>};
async function features(h:Harness,project:string,token=h.admin){const response=await h.call(`/api/p/${project}/issue-features`,'GET',undefined,token);expect(response.status).toBe(200);return await response.json() as Features;}
async function edit(h:Harness,project:string,action:IssueFeatureWrite['action'],token=h.admin){const before=await features(h,project,token),response=await h.call(`/api/p/${project}/issue-features`,'PATCH',{expectedRevision:before.revision,action},token);expect(response.status).toBe(200);return await response.json() as Features;}
async function setup(h:Harness,finalized=true){
 await edit(h,h.source,{kind:'bulk-label',numbers:[h.seed.issue.number],label:'Source context label'});await edit(h,h.source,{kind:'bulk-label',numbers:[h.seed.issue.number],label:'Second unmapped source label'});await edit(h,h.source,{kind:'bulk-assign',numbers:[h.seed.issue.number],assignee:'source-member'});
 const sourceMilestone=await edit(h,h.source,{kind:'milestone-create',title:'Source milestone context'});await edit(h,h.source,{kind:'milestone-assign',number:h.seed.issue.number,milestone:sourceMilestone.milestones[0]!.id});
 const input=await h.prepare();if(!finalized)await h.fixture('lost-ack?target=destination&stage=activation');const moved=await h.call(h.issuePath()+'/transfer','POST',input);if(finalized)expect(moved.status).toBe(200);else expect(moved.status).not.toBe(200);
 const raw=await(await h.fixture('authority?target=destination')).json() as {issues:Array<{number:number}>};expect(raw.issues).toHaveLength(1);const number=raw.issues[0]!.number;
 const created=await h.call(`/api/p/${h.destination}/issues`,'POST',{title:'Current destination catalog',body:'Current destination choices',idempotencyKey:crypto.randomUUID()});expect(created.status).toBe(201);const catalogIssue=(await created.json() as {number:number}).number;
 await edit(h,h.destination,{kind:'bulk-label',numbers:[catalogIssue],label:'Existing destination label'});const milestone=await edit(h,h.destination,{kind:'milestone-create',title:'Current destination milestone'});await h.fixture('mapping-members');const token=(await(await h.fixture('destination-pinned-token')).json() as {secret:string}).secret;
 return {number,catalogIssue,milestone:milestone.milestones.find(row=>row.title==='Current destination milestone')!.id,token,input};
}
const path=(h:Harness,number:number)=>h.issuePath(h.destination,number)+'/transfer-mapping';
async function preview(h:Harness,number:number,token:string){const response=await h.call(path(h,number),'GET',undefined,token);expect(response.status).toBe(200);return checkedMappingPreview(await response.json());}
function request(value:TransferMappingPreview,milestone:number){return createMappingRequest(value,{labels:[{source:'Source context label',destination:'Existing destination label',targetKind:'existing'}],assignees:[{source:'source-member',destination:'destination-principal'}],milestone},crypto.randomUUID());}
const map=(h:Harness,number:number,input:IssueTransferMapping,token:string)=>h.call(path(h,number),'POST',input,token);
async function grants(h:Harness,target:string){const raw=await(await h.fixture('authority?target='+target)).json() as {members:unknown[];writers:unknown[];tasks:string[];preferences:unknown[]};return{members:raw.members,writers:raw.writers,tasks:raw.tasks,preferences:raw.preferences};}

const explicit='destination-only administrators explicitly map transferred context into current destination entries without source access or authority transplant';
test(explicit,async()=>{
 if(await workerdChild(file,explicit))return;const h=await createIssueTransferHarness();
 try{
  const prepared=await setup(h),view=await preview(h,prepared.number,prepared.token),input=request(view,prepared.milestone);expect(view.unmapped.labels).toContain('Second unmapped source label');expect(view.catalog.principals).toContain('destination-principal');expect(view.catalog.principals).not.toContain('source-member');expect(view.catalog.milestones.find(row=>row.id===prepared.milestone)?.title).toBe('Current destination milestone');
  const sourceGrants=await grants(h,'source'),destinationGrants=await grants(h,'destination'),origin=view.origin;await h.fixture('source-read-block');
  const applied=await map(h,prepared.number,input,prepared.token);expect(applied.status).toBe(200);expect(await applied.json()).toMatchObject({requestId:input.requestId,featureRevision:input.expectedRevision+1});const native=await features(h,h.destination,prepared.token);expect(native.triage[String(prepared.number)]).toMatchObject({labels:['Existing destination label'],assignees:['destination-principal'],milestone:prepared.milestone});
  const mapped=await preview(h,prepared.number,prepared.token);expect(mapped.origin).toEqual(origin);expect(mapped.originDigest).toBe(view.originDigest);expect(mapped.unmapped.labels).toEqual(['Second unmapped source label']);expect(mapped.unmapped.assignees).toEqual([]);expect(mapped.unmapped.milestone).toBeNull();expect(await grants(h,'source')).toEqual(sourceGrants);expect(await grants(h,'destination')).toEqual(destinationGrants);
  expect(await(await h.fixture('source-read-status')).json() as {attempts:number}).toEqual({attempts:0});
 }finally{await h.dispose();}
},60000);

const permissions='transfer context mapping denies read and app credentials and requires a finalized transferred destination';
test(permissions,async()=>{
 if(await workerdChild(file,permissions))return;const h=await createIssueTransferHarness();
 try{
  const prepared=await setup(h),view=await preview(h,prepared.number,prepared.token),input=request(view,prepared.milestone);
  const appToken=(await(await h.fixture('destination-oauth')).json() as {token:string}).token;expect((await h.call(h.issuePath(h.destination,prepared.number),'GET',undefined,appToken)).status).toBe(200);
  const memberToken=await h.sign('destination-principal');expect((await h.call(h.issuePath(h.destination,prepared.number),'GET',undefined,memberToken)).status).toBe(200);
  for(const token of [h.seed.tokens.read!.secret,h.seed.tokens.member!.secret,h.seed.oauth,appToken,memberToken]){const inspect=await h.call(path(h,prepared.number),'GET',undefined,token);expect([401,403,404]).toContain(inspect.status);const rejected=await map(h,prepared.number,input,token);expect([401,403,404]).toContain(rejected.status);await h.noPrivate(rejected);}
  const native=await h.call(path(h,prepared.catalogIssue),'GET',undefined,prepared.token);expect([404,409]).toContain(native.status);await h.noPrivate(native);const missing=await h.call(path(h,999999),'GET',undefined,prepared.token);expect([404,409,410]).toContain(missing.status);
  const original=await h.call(h.issuePath()+'/transfer-mapping','GET',undefined,h.admin);expect([404,409,410]).toContain(original.status);
  const session=await h.sign('destination-only-admin'),ok=await map(h,prepared.number,input,session);expect(ok.status).toBe(200);expect(await ok.json()).toMatchObject({requestId:input.requestId});
 }finally{await h.dispose();}
},60000);

const unfinalized='an active incoming transfer cannot be mapped until its original destination finalization is proven';
test(unfinalized,async()=>{
 if(await workerdChild(file,unfinalized))return;const h=await createIssueTransferHarness();
 try{
  const prepared=await setup(h,false),response=await h.call(path(h,prepared.number),'GET',undefined,prepared.token);expect([404,409]).toContain(response.status);await h.noPrivate(response);const native=await features(h,h.destination,prepared.token);expect(native.triage[String(prepared.number)]?.assignees??[]).toEqual([]);
 }finally{await h.dispose();}
},60000);

const stale='mapping fingerprints reject changed origins revisions catalogs and destination principals without applying stale choices';
test(stale,async()=>{
 if(await workerdChild(file,stale))return;const h=await createIssueTransferHarness();
 try{
  const prepared=await setup(h),view=await preview(h,prepared.number,prepared.token),input=request(view,prepared.milestone),before=await features(h,h.destination,prepared.token);
  for(const invalid of [{...input,originDigest:'0'.repeat(64)},{...input,expectedRevision:input.expectedRevision+1},{...input,principalGeneration:'invalid-generation'},{...input,labels:[{source:'Source context label',destination:'Unregistered destination label',targetKind:'existing' as const}]},{...input,assignees:[{source:'source-member',destination:'source-member'}]},{...input,milestone:999999}]){const rejected=await map(h,prepared.number,invalid,prepared.token);expect([400,403,409]).toContain(rejected.status);}
  expect(await features(h,h.destination,prepared.token)).toEqual(before);await edit(h,h.destination,{kind:'bulk-label',numbers:[prepared.catalogIssue],label:'New destination catalog generation'});expect((await map(h,prepared.number,input,prepared.token)).status).toBe(409);const fresh=await preview(h,prepared.number,prepared.token),freshRequest=request(fresh,prepared.milestone);await h.fixture('principal-remove');expect([403,409]).toContain((await map(h,prepared.number,freshRequest,prepared.token)).status);expect((await features(h,h.destination,prepared.token)).triage[String(prepared.number)]?.assignees??[]).toEqual([]);
 }finally{await h.dispose();}
},60000);

for(const [name,change] of [['mapping rejects a renewed mapper administrator epoch after an awaited commit admission','mapper'],['mapping rejects a selected principal removed and regranted after its roster was confirmed','principal']] as const){
 test(name,async()=>{
  if(await workerdChild(file,name))return;const h=await createIssueTransferHarness();let pending:Promise<Response>|undefined;
  try{
   const prepared=await setup(h),view=await preview(h,prepared.number,prepared.token),input=request(view,prepared.milestone),before=await features(h,h.destination,prepared.token);await h.fixture('mapping-arm');pending=map(h,prepared.number,input,prepared.token);await h.waitPaused('mapping','destination');await h.fixture(change==='mapper'?'mapper-revoke':'principal-remove');await h.fixture(change==='mapper'?'mapper-regrant':'principal-restore');await h.fixture('mapping-resume');const denied=await pending;pending=undefined;expect(change==='mapper'?403:409).toBe(denied.status);await h.noPrivate(denied);expect(await features(h,h.destination,prepared.token)).toEqual(before);
  }finally{await h.fixture('mapping-resume').catch(()=>undefined);await pending?.catch(()=>undefined);await h.dispose();}
 },60000);
}

const unknown='mapping acknowledgement loss resumes only its immutable UUID without duplicating assignments or overwriting later native edits';
test(unknown,async()=>{
 if(await workerdChild(file,unknown))return;const h=await createIssueTransferHarness();
 try{
  const prepared=await setup(h),view=await preview(h,prepared.number,prepared.token),input=request(view,prepared.milestone);await h.fixture('mapping-ack');const lost=await map(h,prepared.number,input,prepared.token);expect(lost.status).not.toBe(200);await h.noPrivate(lost);const after=await features(h,h.destination,prepared.token);expect(after.revision).toBe(input.expectedRevision+1);
  await edit(h,h.destination,{kind:'bulk-label',numbers:[prepared.number],label:'Later destination native edit'},prepared.token);const latest=await features(h,h.destination,prepared.token),retry=await map(h,prepared.number,input,prepared.token);expect(retry.status).toBe(200);expect(await retry.json()).toMatchObject({requestId:input.requestId,featureRevision:after.revision});expect(await features(h,h.destination,prepared.token)).toEqual(latest);expect(latest.triage[String(prepared.number)]?.labels.filter(value=>value==='Existing destination label')).toHaveLength(1);expect(latest.triage[String(prepared.number)]?.assignees.filter(value=>value==='destination-principal')).toHaveLength(1);expect(latest.triage[String(prepared.number)]?.labels).toContain('Later destination native edit');
  const changed=await map(h,prepared.number,{...input,milestone:null},prepared.token);expect(changed.status).toBe(409);expect((await preview(h,prepared.number,prepared.token)).origin).toEqual(view.origin);
 }finally{await h.dispose();}
},60000);

const paging='mapping principal pages remain complete across inactive accounts and reject renewed roster cursors';
test(paging,async()=>{
 if(await workerdChild(file,paging))return;const h=await createIssueTransferHarness();
 try{
  const prepared=await setup(h),roster=await(await h.fixture('principal-pages')).json() as {active:string[];inactive:string[]};
  type Page={canMap:boolean;originDigest:string;featureRevision:number;principalGeneration:string;catalog:{principals:string[]};principalPage:{complete:boolean;nextCursor:string|null;generation:string}};
  const firstResponse=await h.call(path(h,prepared.number),'GET',undefined,prepared.token);expect(firstResponse.status).toBe(200);const first=await firstResponse.json() as Page&TransferMappingPreview;checkedMappingPreview(first);expect(first.principalPage.complete).toBe(false);expect(first.principalPage.nextCursor).not.toBeNull();expect(first.principalPage.generation).toBe(first.principalGeneration);
  const response=await h.call(path(h,prepared.number)+'?principalCursor='+encodeURIComponent(first.principalPage.nextCursor!),'GET',undefined,prepared.token);expect(response.status).toBe(200);const second=await response.json() as Page;expect(Object.keys(second).sort()).toEqual(['canMap','catalog','featureRevision','originDigest','principalGeneration','principalPage'].sort());expect(Object.keys(second.catalog)).toEqual(['principals']);expect(second.principalPage.complete).toBe(true);expect(second.principalPage.nextCursor).toBeNull();expect(second.originDigest).toBe(first.originDigest);expect(second.featureRevision).toBe(first.featureRevision);expect(second.principalGeneration).toBe(first.principalGeneration);
  const all=[...first.catalog.principals,...second.catalog.principals];expect(new Set(all).size).toBe(all.length);for(const userId of roster.active)expect(all).toContain(userId);for(const userId of roster.inactive)expect(all).not.toContain(userId);expect(all).toHaveLength(roster.active.length+3);
  expect((await h.call(path(h,prepared.number)+'?search=paging','GET',undefined,prepared.token)).status).toBe(400);expect((await h.call(path(h,prepared.number)+'?pageSize=100','GET',undefined,prepared.token)).status).toBe(400);
  await h.fixture('principal-page-renew');const staleCursor=await h.call(path(h,prepared.number)+'?principalCursor='+encodeURIComponent(first.principalPage.nextCursor!),'GET',undefined,prepared.token);expect(staleCursor.status).toBe(409);const fresh=await h.call(path(h,prepared.number),'GET',undefined,prepared.token);expect(fresh.status).toBe(200);expect((await fresh.json() as Page).principalGeneration).not.toBe(first.principalGeneration);
 }finally{await h.dispose();}
},60000);

const emptyPage='mapping pagination advances past a wholly inactive first candidate page instead of implying an empty roster';
test(emptyPage,async()=>{
 if(await workerdChild(file,emptyPage))return;const h=await createIssueTransferHarness();
 try{
  const prepared=await setup(h),roster=await(await h.fixture('principal-pages?emptyFirst=true')).json() as {active:string[];inactive:string[]};const first=await(await h.call(path(h,prepared.number),'GET',undefined,prepared.token)).json() as TransferMappingPreview&{principalPage:{complete:boolean;nextCursor:string|null}};expect(first.catalog.principals).toEqual([]);expect(first.principalPage.complete).toBe(false);expect(first.principalPage.nextCursor).not.toBeNull();
  const response=await h.call(path(h,prepared.number)+'?principalCursor='+encodeURIComponent(first.principalPage.nextCursor!),'GET',undefined,prepared.token);expect(response.status).toBe(200);const next=await response.json() as {catalog:{principals:string[]};principalPage:{complete:boolean}};expect(next.principalPage.complete).toBe(true);for(const userId of roster.active)expect(next.catalog.principals).toContain(userId);for(const userId of roster.inactive)expect(next.catalog.principals).not.toContain(userId);expect(next.catalog.principals).toHaveLength(roster.active.length+3);
 }finally{await h.dispose();}
},60000);

for(const kind of ['origin','manifest'] as const){const name=`mapping rejects a corrupted canonical ${kind} instead of accepting a new imported authority claim`;
 test(name,async()=>{
  if(await workerdChild(file,name))return;const h=await createIssueTransferHarness();
  try{
   const prepared=await setup(h),view=await preview(h,prepared.number,prepared.token),input=request(view,prepared.milestone),before=await features(h,h.destination,prepared.token);await h.fixture(`mapping-tamper?number=${prepared.number}&kind=${kind}`);const inspected=await h.call(path(h,prepared.number),'GET',undefined,prepared.token);expect([409,410]).toContain(inspected.status);const rejected=await map(h,prepared.number,input,prepared.token);expect([409,410]).toContain(rejected.status);expect(await features(h,h.destination,prepared.token)).toEqual(before);
  }finally{await h.dispose();}
 },60000);
}

const deletedAccount='mapping refreshes selected account eligibility after an awaited digest without assigning a deleted principal';
test(deletedAccount,async()=>{
 if(await workerdChild(file,deletedAccount))return;const h=await createIssueTransferHarness();let pending:Promise<Response>|undefined;
 try{
  const prepared=await setup(h),view=await preview(h,prepared.number,prepared.token),input=request(view,prepared.milestone),before=await features(h,h.destination,prepared.token);await h.fixture('mapping-arm');pending=map(h,prepared.number,input,prepared.token);await h.waitPaused('mapping','destination');await h.fixture('principal-account-delete');await h.fixture('mapping-resume');const denied=await pending;pending=undefined;expect([403,409]).toContain(denied.status);expect(await features(h,h.destination,prepared.token)).toEqual(before);expect((await preview(h,prepared.number,prepared.token)).catalog.principals).not.toContain('destination-principal');
 }finally{await h.fixture('mapping-resume').catch(()=>undefined);await pending?.catch(()=>undefined);await h.dispose();}
},60000);

const revokedAcknowledgement='mapping withholds its acknowledgement after administrator revocation while preserving the exact committed retry receipt';
test(revokedAcknowledgement,async()=>{
 if(await workerdChild(file,revokedAcknowledgement))return;const h=await createIssueTransferHarness();let pending:Promise<Response>|undefined;
 try{
  const prepared=await setup(h),view=await preview(h,prepared.number,prepared.token),input=request(view,prepared.milestone);await h.fixture('mapping-after-arm');pending=map(h,prepared.number,input,prepared.token);await h.waitPaused('mapping','destination');await h.fixture('mapper-revoke');await h.fixture('mapping-resume');const denied=await pending;pending=undefined;expect(denied.status).toBe(403);await h.noPrivate(denied);
  const committed=await features(h,h.destination,h.admin);expect(committed.revision).toBe(input.expectedRevision+1);expect(committed.triage[String(prepared.number)]).toMatchObject({labels:['Existing destination label'],assignees:['destination-principal'],milestone:prepared.milestone});await h.fixture('mapper-regrant');const regranted=await features(h,h.destination,h.admin);expect({revision:regranted.revision,milestones:regranted.milestones,triage:regranted.triage}).toEqual({revision:committed.revision,milestones:committed.milestones,triage:committed.triage});const replay=await map(h,prepared.number,input,prepared.token);expect(replay.status).toBe(200);expect(await replay.json()).toMatchObject({requestId:input.requestId,featureRevision:committed.revision});expect(await features(h,h.destination,prepared.token)).toEqual(regranted);
 }finally{await h.fixture('mapping-resume').catch(()=>undefined);await pending?.catch(()=>undefined);await h.dispose();}
},60000);
