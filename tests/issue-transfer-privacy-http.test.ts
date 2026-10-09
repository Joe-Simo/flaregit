import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';
import type {IssueTransferPreview,IssueTransferRequest,issueTransferView} from '../src/server/issue-transfer-api';

type TransferView=ReturnType<typeof issueTransferView>;
type FixtureAuthority={writers:Array<{task_id:string;user_id:string}>;members:Array<{user_id:string;role:string}>;tasks:string[];preferences:Array<{actor_id:string;subject:string}>;issues:Array<{number:number;title:string}>};
const source='p111111111111',destination='p222222222222';

test('signed cross-repository issue transfer preserves privacy through hidden reservations, lost acknowledgements and authorization revocation',async()=>{
 if(await workerdChild('tests/issue-transfer-privacy-http.test.ts'))return;
 const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'issue-transfer-local',alg:'RS256',use:'sig'};
 const issuer=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({keys:[jwk]})}),file=`/tmp/issue-transfer-privacy-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,'build','tests/support/issue-transfer-privacy-http-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*','--outfile='+file],{stdout:'ignore',stderr:'pipe'});
 if(await build.exited){issuer.stop(true);throw Error(await new Response(build.stderr).text());}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'issue-transfer-privacy',unsafeDirectSockets:[{host:'127.0.0.1',port:0}],modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:'IssueTransferPrivacyFixture',useSQLite:true},AUTHORITY:{className:'AuthorityController',useSQLite:true}},r2Buckets:{EVIDENCE_BUCKET:'issue-transfer-real-bytes'}}]}));
 let pending:Promise<Response>|undefined;
 try{
  const origin=(await mf.unsafeGetDirectURL('issue-transfer-privacy')).origin;
  const fixture=async(path:string)=>{const response=await fetch(origin+'/fixture/'+path);expect(response.status).toBe(200);return response;};
  const seed=await(await fixture('seed')).json() as {issue:{number:number;revision:number};tokens:Record<string,{secret:string;id:string}>;oauth:string};
  const sign=(subject:string)=>new SignJWT({azp:'https://fixture.example'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
  const admin=await sign('transfer-admin'),member=await sign('source-member');
  const call=(token:string,path:string,method='GET',body?:unknown)=>fetch(origin+path,{method,headers:{Authorization:'Bearer '+token,'CF-Connecting-IP':'198.51.100.99','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const sourceIssue=(number:number)=>`/api/p/${source}/issues/${number}`;
  const targetIssue=(number:number)=>`/api/p/${destination}/issues/${number}`;
  const noPrivateBody=async(response:{text():Promise<string>})=>{const text=await response.text();for(const secret of ['Private transferable issue secret','Private transferable body secret','Private transferable comment secret','Private source task secret'])expect(text).not.toContain(secret);};
  const authority=async(target='destination')=>await(await fixture('authority?target='+target)).json() as FixtureAuthority;
  const waitPaused=async(kind:'hook'|'read',target:string)=>{const deadline=Date.now()+5000;while(Date.now()<deadline){const status=await(await fixture(`${kind}-status?target=${target}`)).json() as {paused:string|boolean|null};if(status.paused)return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Actual transfer did not reach its bounded fixture pause');};
  const upload=async(number:number)=>{
   const bytes=new Uint8Array([0,255,128,10,13,0,1]),id=crypto.randomUUID(),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
   expect((await call(admin,sourceIssue(number)+'/attachments','POST',{id,name:'proof.bin',sha256,size:bytes.length})).status).toBe(201);
   const response=await fetch(origin+sourceIssue(number)+`/attachments/${id}/content`,{method:'PUT',headers:{Authorization:'Bearer '+admin,'CF-Connecting-IP':'198.51.100.99','content-type':'application/octet-stream'},body:bytes});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({phase:'verified'});return{bytes,id,sha256};
  };
  const confirm=async(number:number):Promise<IssueTransferRequest>=>{const response=await call(admin,sourceIssue(number)+`/transfer-preview?destinationProjectId=${destination}`);expect(response.status).toBe(200);const preview=await response.json() as IssueTransferPreview;expect(preview.destination.audience).toBe('repository-members');return {destinationProjectId:destination,expectedRevision:preview.source.stateRevision,requestId:crypto.randomUUID(),confirmed:true,expectedManifestDigest:preview.manifestDigest,expectedDestinationIncarnation:preview.destination.incarnation};};
  const transfer=(number:number,input:IssueTransferRequest,token=admin)=>call(token,sourceIssue(number)+'/transfer','POST',input);
  const hidden=async(number:number)=>{
   const issue=await call(admin,targetIssue(number));expect([403,404,410]).toContain(issue.status);await noPrivateBody(issue);
   const list=await call(admin,`/api/p/${destination}/issues`);expect(list.status).toBe(200);expect((await list.json() as Array<{number:number}>).some(row=>row.number===number)).toBe(false);
   const comments=await call(admin,`/api/p/${destination}/comments?subject=issue:${number}&page=1`);expect([403,404,410]).toContain(comments.status);await noPrivateBody(comments);
   const archive=await call(admin,`/api/p/${destination}/metadata-archive`);expect(archive.status).toBe(200);const exported=await archive.json() as {archive:{tables:Array<{name:string;rows:Array<Record<string,unknown>>}>}};expect(exported.archive.tables.find(table=>table.name==='issues')?.rows.some(row=>row.number===number)??false).toBe(false);expect(exported.archive.tables.find(table=>table.name==='comments')?.rows.some(row=>row.subject===`issue:${number}`)??false).toBe(false);expect(exported.archive.tables.find(table=>table.name==='issue_transfer_feature_origins')?.rows.some(row=>row.issue_number===number)??false).toBe(false);expect(exported.archive.tables.find(table=>table.name==='metadata_archive_origins')?.rows.some(row=>row.table_name==='issues'&&row.resource_id===String(number))??false).toBe(false);
   const planning=await call(admin,`/api/p/${destination}/planning`);expect(planning.status).toBe(200);const planned=await planning.json() as {issues:Array<{number:number}>;plan:{project:{items:Array<{issueNumber:number}>};assignments:Array<{issueNumber:number}>};inactiveReferences:Array<{issueNumber:number}>};expect(planned.issues.some(row=>row.number===number)).toBe(false);expect(planned.plan.project.items.some(row=>row.issueNumber===number)).toBe(false);expect(planned.plan.assignments.some(row=>row.issueNumber===number)).toBe(false);expect(planned.inactiveReferences.some(row=>row.issueNumber===number)).toBe(false);
   const filtered=await call(admin,`/api/p/${destination}/issues/query?q=Private%20transferable`);expect(filtered.status).toBe(200);expect((await filtered.json() as {issues:Array<{number:number}>}).issues.some(row=>row.number===number)).toBe(false);
   const search=await call(admin,'/api/search?q=Private%20transferable');expect(search.status).toBe(200);const result=await search.json() as {results:Array<{id:string;href:string}>};expect(result.results.some(row=>row.id===`${destination}:issue:${number}`)).toBe(false);
  };
  const completed=async(number:number,input:IssueTransferRequest,expectedDestination:number)=>{const response=await transfer(number,input);expect(response.status).toBe(200);const view=await response.json() as TransferView;expect(view).toMatchObject({requestId:input.requestId,completed:true,destination:{projectId:destination,number:expectedDestination}});const retry=await transfer(number,input);expect(retry.status).toBe(200);expect(await retry.json()).toMatchObject({requestId:input.requestId,destination:{number:expectedDestination},completed:true});return view;};

  const binary=await upload(seed.issue.number),input=await confirm(seed.issue.number);
  // The installed OAuth token is genuinely active for issue reads, but cannot transfer.
  expect((await call(seed.oauth,sourceIssue(seed.issue.number))).status).toBe(200);
  for(const token of [seed.tokens.read!.secret,seed.tokens.pinned!.secret,seed.tokens.sourceOnly!.secret,seed.tokens.destinationOnly!.secret,seed.tokens.member!.secret,seed.oauth]){const response=await transfer(seed.issue.number,input,token);expect([401,403,404]).toContain(response.status);await noPrivateBody(response);}
  expect((await authority()).issues).toEqual([]);

  await fixture('lost-ack?target=destination&stage=reservation');const unknownReservation=await transfer(seed.issue.number,input);expect(unknownReservation.status).not.toBe(200);const unknownReservationBody=await unknownReservation.text();await noPrivateBody({text:async()=>unknownReservationBody});
  const reservationDiagnostic={status:unknownReservation.status,body:unknownReservationBody,source:await authority('source'),destination:await authority()};
  const reserved=(await authority()).issues;expect(reserved,JSON.stringify(reservationDiagnostic)).toHaveLength(1);const targetNumber=reserved[0]!.number;await hidden(targetNumber);
  const frozenWrite=await call(admin,sourceIssue(seed.issue.number),'PATCH',{state:'closed',expectedRevision:input.expectedRevision,requestId:crypto.randomUUID()});expect([403,409]).toContain(frozenWrite.status);
  const frozenComment=await call(admin,`/api/p/${source}/comments`,'POST',{subject:`issue:${seed.issue.number}`,body:'Attempt while original transfer is frozen',idempotencyKey:crypto.randomUUID()});expect([403,409]).toContain(frozenComment.status);

  await fixture('hook-arm?target=destination&stage=activation');pending=transfer(seed.issue.number,input);await waitPaused('hook','destination');await hidden(targetNumber);
  await fixture('revoke?target=source');await fixture('hook-resume?target=destination');const sourceRevoked=await pending;pending=undefined;expect(sourceRevoked.status).not.toBe(200);await noPrivateBody(sourceRevoked);await hidden(targetNumber);
  await fixture('regrant?target=source');await completed(seed.issue.number,input,targetNumber);expect((await authority()).issues).toHaveLength(1);
  const visible=await call(admin,targetIssue(targetNumber));expect(visible.status).toBe(200);expect(await visible.json()).toMatchObject({title:'Private transferable issue secret',body:'Private transferable body secret',comments:[{body:'Private transferable comment secret'}],transferOrigin:{source:{projectId:source,number:seed.issue.number},authorityTransferred:false,inlineAnchors:'source-origin-only',attribution:{identity:'source-origin',issueActorId:null}}});
  const attachments=await call(admin,targetIssue(targetNumber)+'/attachments');expect(attachments.status).toBe(200);const targetFiles=await attachments.json() as {attachments:Array<{id:string;sha256:string;phase:string}>};expect(targetFiles.attachments).toHaveLength(1);expect(targetFiles.attachments[0]).toMatchObject({sha256:binary.sha256,phase:'verified'});expect(targetFiles.attachments[0]!.id).not.toBe(binary.id);
  const downloaded=await call(admin,targetIssue(targetNumber)+`/attachments/${targetFiles.attachments[0]!.id}/content`);expect(downloaded.status).toBe(200);expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(binary.bytes);
  const destinationAuthority=await authority();expect(destinationAuthority.tasks).toEqual([]);expect(destinationAuthority.writers).toEqual([]);expect((await authority('source')).writers).toContainEqual({task_id:'source-linked-task',user_id:'source-member'});expect(destinationAuthority.preferences).toEqual([]);expect(destinationAuthority.members.some(row=>row.user_id==='source-member')).toBe(false);expect((await authority('source')).tasks).toContain('source-linked-task');
  const sourceGone=await call(admin,sourceIssue(seed.issue.number));expect(sourceGone.status).toBe(410);const linked=await sourceGone.text();expect(linked).toContain(destination);expect(linked).not.toContain('Private transferable');
  const noDestination=await call(seed.tokens.sourceOnly!.secret,sourceIssue(seed.issue.number));expect(noDestination.status).toBe(410);const sourceOnlyBody=await noDestination.text();expect(sourceOnlyBody).not.toContain(destination);expect(sourceOnlyBody).not.toContain('Private transferable');
  expect((await call(member,targetIssue(targetNumber))).status).not.toBe(200);

  const next=await(await fixture('new-issue')).json() as {number:number;revision:number};await upload(next.number);const second=await confirm(next.number);
  await fixture('read-arm?target=source');pending=transfer(next.number,second);await waitPaused('read','source');const secondTarget=(await authority()).issues.at(-1)!.number;await hidden(secondTarget);
  await fixture('revoke?target=destination');await fixture('read-resume?target=source');const destinationRevoked=await pending;pending=undefined;expect(destinationRevoked.status).not.toBe(200);await noPrivateBody(destinationRevoked);
  const revokedLink=await call(admin,sourceIssue(seed.issue.number));expect(revokedLink.status).toBe(410);expect(await revokedLink.text()).not.toContain(destination);
  await fixture('regrant?target=destination');await hidden(secondTarget);
  // No bytes landed before authorization was withdrawn. An unknown copy may
  // only reconcile positive exact readback, never redispatch the same attempt.
  const unconfirmed=await transfer(next.number,second);expect(unconfirmed.status).not.toBe(200);await noPrivateBody(unconfirmed);expect((await authority()).issues).toHaveLength(2);
  const preserved=await call(admin,sourceIssue(next.number));expect(preserved.status).toBe(200);expect(await preserved.json()).toMatchObject({title:'Private transferable issue secret',transferPending:true});

  const third=await(await fixture('new-issue')).json() as {number:number;revision:number},thirdInput=await confirm(third.number);
  await fixture('lost-ack?target=destination&stage=activation');const activationAck=await transfer(third.number,thirdInput);if(activationAck.status!==200)await noPrivateBody(activationAck);const thirdTarget=(await authority()).issues.at(-1)!.number;await completed(third.number,thirdInput,thirdTarget);expect((await authority()).issues).toHaveLength(3);

  const fourth=await(await fixture('new-issue')).json() as {number:number;revision:number},fourthInput=await confirm(fourth.number);
  await fixture('finalization-dispatch-loss?target=destination');const unfinished=await transfer(fourth.number,fourthInput);expect(unfinished.status).toBe(503);await noPrivateBody(unfinished);const fourthTarget=(await authority()).issues.at(-1)!.number;
  const sourceCompleted=await call(admin,sourceIssue(fourth.number));expect(sourceCompleted.status).toBe(410);await noPrivateBody(sourceCompleted);
  const statusPath=sourceIssue(fourth.number)+`/transfer/${fourthInput.requestId}`;
  const finishing=await call(admin,statusPath);expect(finishing.status).toBe(200);expect(await finishing.json()).toMatchObject({requestId:fourthInput.requestId,phase:'active',completed:false,destination:{projectId:destination,number:fourthTarget}});
  const lockedDestination=await call(admin,targetIssue(fourthTarget));expect(lockedDestination.status).toBe(200);const lockedIssue=await lockedDestination.json() as {stateRevision:number};
  const lockedWrite=await call(admin,targetIssue(fourthTarget),'PATCH',{state:'closed',expectedRevision:lockedIssue.stateRevision,requestId:crypto.randomUUID()});expect([403,409]).toContain(lockedWrite.status);
  await completed(fourth.number,fourthInput,fourthTarget);const finalized=await call(admin,statusPath);expect(finalized.status).toBe(200);expect(await finalized.json()).toMatchObject({phase:'completed',completed:true,destination:{number:fourthTarget}});expect((await authority()).issues).toHaveLength(4);
  const currentDestination=await(await call(admin,targetIssue(fourthTarget))).json() as {stateRevision:number};expect((await call(admin,targetIssue(fourthTarget),'PATCH',{state:'closed',expectedRevision:currentDestination.stateRevision,requestId:crypto.randomUUID()})).status).toBe(200);

  const fifth=await(await fixture('new-issue')).json() as {number:number;revision:number},fifthInput=await confirm(fifth.number);
  await fixture('lost-ack?target=destination&stage=finalization');const finalizedAck=await transfer(fifth.number,fifthInput);expect(finalizedAck.status).not.toBe(200);await noPrivateBody(finalizedAck);const fifthTarget=(await authority()).issues.at(-1)!.number;
  const observedCommit=await call(admin,sourceIssue(fifth.number)+`/transfer/${fifthInput.requestId}`);expect(observedCommit.status).toBe(200);expect(await observedCommit.json()).toMatchObject({phase:'completed',completed:true,destination:{number:fifthTarget}});await completed(fifth.number,fifthInput,fifthTarget);expect((await authority()).issues).toHaveLength(5);

  const sixth=await(await fixture('new-issue')).json() as {number:number;revision:number},sixthInput=await confirm(sixth.number);
  await fixture('hook-arm?target=source&stage=freeze');pending=transfer(sixth.number,sixthInput);await waitPaused('hook','source');await fixture('revoke?target=source');await fixture('regrant?target=source');await fixture('hook-resume?target=source');const superseded=await pending;pending=undefined;expect(superseded.status).toBe(403);await noPrivateBody(superseded);expect((await authority()).issues).toHaveLength(5);
  const epochPreserved=await call(admin,sourceIssue(sixth.number));expect(epochPreserved.status).toBe(200);expect(await epochPreserved.json()).toMatchObject({title:'Private transferable issue secret',transferPending:false});

 }finally{
  const endpoint=await mf.unsafeGetDirectURL('issue-transfer-privacy').catch(()=>null);if(endpoint)for(const target of ['source','destination'])for(const kind of ['hook','read'])await fetch(endpoint.origin+`/fixture/${kind}-resume?target=${target}`).catch(()=>undefined);await pending?.catch(()=>undefined);await mf.dispose();issuer.stop(true);
 }
},120000);
