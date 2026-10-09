import {Database} from 'bun:sqlite';
import {expect,test} from 'bun:test';
import {IssueTransferLedger,IssueTransferActiveDestinationError,issueTransferManifestSchema,normalizeIssueTransferCancellation,type IssueTransferManifest} from '../src/server/issue-transfer';
import {canonicalTransferJson} from '../src/server/issue-transfer-api';

function manifest():IssueTransferManifest{return{
 requestId:crypto.randomUUID(),actorId:'owner',previewDigest:'a'.repeat(64),audienceVersion:'repository-members-v1',
 source:{projectId:'source',incarnation:'source-incarnation',number:1,createdAt:'2026-10-08T12:00:00Z',author:'Owner',stateRevision:0},
 destination:{projectId:'destination',incarnation:crypto.randomUUID(),audienceDigest:'b'.repeat(64),audienceVersion:'repository-members-v1'},
 issue:{number:1,title:'Frozen issue',body:'Original content',state:'open',author:'Owner',created_at:'2026-10-08T12:00:00Z',updated_at:'2026-10-08T12:00:00Z',closed_by:null},
 comments:[],attribution:{issueActorId:'owner',commentActorIds:{},identity:'source-origin'},features:{labels:[]},attachments:[{id:crypto.randomUUID(),destinationId:crypto.randomUUID(),producerIdentity:'owned-object-generation',name:'evidence.bin',sha256:'c'.repeat(64),size:1,authorId:'owner',author:'Owner',createdAt:'2026-10-08T12:00:00Z'}],
};}
test('transfer proof canonicalization preserves attachment values across schema normalization',()=>{
 const value=manifest(),attachment=value.attachments[0]!;
 const source={id:attachment.id,name:attachment.name,sha256:attachment.sha256,size:attachment.size,authorId:attachment.authorId,author:attachment.author,createdAt:attachment.createdAt,producerIdentity:attachment.producerIdentity};
 const parsed=issueTransferManifestSchema.parse(value);
 const {destinationId:_destinationId,...frozen}=parsed.attachments[0]!;
 expect(JSON.stringify(source)).not.toBe(JSON.stringify(frozen));
 expect(canonicalTransferJson(source)).toBe(canonicalTransferJson(frozen));
 expect(canonicalTransferJson({...frozen,sha256:'d'.repeat(64)})).not.toBe(canonicalTransferJson(source));
 expect(canonicalTransferJson({...frozen,size:2})).not.toBe(canonicalTransferJson(source));
 const second={...source,id:crypto.randomUUID()};
 expect(canonicalTransferJson([source,second])).not.toBe(canonicalTransferJson([second,source]));
});

test('transfer cancellation fences absent destination before source unlock and cannot revive cancelled UUID',()=>{
 const sourceDb=new Database(':memory:'),destinationDb=new Database(':memory:');
 const storages=[sourceDb,destinationDb].map(db=>({sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(operation:()=>T){return db.transaction(operation)();}} as unknown as DurableObjectStorage));
 try{
  const source=new IssueTransferLedger(storages[0]!),destination=new IssueTransferLedger(storages[1]!),value=manifest();
  source.freeze(value,()=>{});
  const input={requestId:value.requestId,cancelId:crypto.randomUUID(),expectedManifestDigest:value.previewDigest,expectedDestinationIncarnation:value.destination.incarnation,confirmed:true as const};
  expect(source.beginCancellation(value.requestId,input,'rescue-owner',()=>{}).phase).toBe('cancelling');
  expect(()=>source.assertTransferContinues(value.requestId)).toThrow('pending');
  const cancelled=destination.cancelDestination(value,input,'rescue-owner',()=>{});expect(cancelled.phase).toBe('cancelled');
  expect(()=>destination.cancelDestination(value,{...input,expectedManifestDigest:'f'.repeat(64)},'rescue-owner',()=>{})).toThrow('scope does not match');
  expect(()=>destination.cancelDestination(value,input,'another-owner',()=>{})).toThrow('cannot change');
  let allocated=false;expect(()=>destination.reserve(value,()=>{allocated=true;return 8;},()=>{})).toThrow('cancelled');expect(allocated).toBe(false);
  expect(()=>source.completeCancellation(value.requestId,input.cancelId,()=>{throw Error('Destination cancellation is unconfirmed');})).toThrow('unconfirmed');
  expect(()=>source.assertWritable(1)).toThrow('in progress');
  expect(source.completeCancellation(value.requestId,input.cancelId,()=>{}).phase).toBe('cancelled');expect(()=>source.assertWritable(1)).not.toThrow();
  expect(()=>source.freeze(value,()=>{})).toThrow('cancelled');
  expect(destination.cancelDestination(value,input,'rescue-owner',()=>{})).toEqual(cancelled);
  expect(()=>source.beginCancellation(value.requestId,{...input,cancelId:crypto.randomUUID()},'rescue-owner',()=>{})).toThrow('cannot change');
  const fresh={...value,requestId:crypto.randomUUID()};expect(source.freeze(fresh,()=>{}).phase).toBe('frozen');
 }finally{sourceDb.close();destinationDb.close();}
});

test('active destination wins cancellation without removing source lock or reviving cancelled generations',()=>{
 const sourceDb=new Database(':memory:'),destinationDb=new Database(':memory:');
 const storages=[sourceDb,destinationDb].map(db=>({sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(operation:()=>T){return db.transaction(operation)();}} as unknown as DurableObjectStorage));
 try{
  const source=new IssueTransferLedger(storages[0]!),destination=new IssueTransferLedger(storages[1]!),value={...manifest(),attachments:[]};source.freeze(value,()=>{});destination.reserve(value,()=>8,()=>{});destination.markReady(value.requestId,()=>true,()=>{});destination.activate(value.requestId,()=>true,()=>{});
  const input={requestId:value.requestId,cancelId:crypto.randomUUID(),expectedManifestDigest:value.previewDigest,expectedDestinationIncarnation:value.destination.incarnation,confirmed:true as const};source.beginCancellation(value.requestId,input,'owner',()=>{});
  expect(()=>destination.cancelDestination(value,input,'owner',()=>{})).toThrow(IssueTransferActiveDestinationError);
  expect(destination.readCancellation(value.requestId)).toBeUndefined();
  expect(source.denyCancellationActive(value.requestId,input.cancelId,()=>{}).phase).toBe('denied-active');expect(source.read(value.requestId)?.phase).toBe('frozen');expect(()=>source.assertTransferContinues(value.requestId)).not.toThrow();expect(()=>source.assertWritable(1)).toThrow('in progress');
  source.bindDestination(value.requestId,8,()=>{});source.complete(value.requestId,()=>{});
  expect(()=>source.beginCancellation(value.requestId,input,'owner',()=>{})).toThrow(IssueTransferActiveDestinationError);expect(source.read(value.requestId)?.phase).toBe('completed');
 }finally{sourceDb.close();destinationDb.close();}
});

test('completed source refuses cancellation without creating an uncertain intent or changing its lock',()=>{
 const db=new Database(':memory:');
 const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(operation:()=>T){return db.transaction(operation)();}} as unknown as DurableObjectStorage;
 try{
  const ledger=new IssueTransferLedger(storage),value=manifest();ledger.freeze(value,()=>{});ledger.bindDestination(value.requestId,8,()=>{});ledger.complete(value.requestId,()=>{});
  const before=ledger.read(value.requestId),lock=db.query('SELECT request_id,document FROM issue_transfer_locks WHERE issue_number=1').get();
  const input={requestId:value.requestId,cancelId:crypto.randomUUID(),expectedManifestDigest:value.previewDigest,expectedDestinationIncarnation:value.destination.incarnation,confirmed:true as const};
  expect(()=>ledger.beginCancellation(value.requestId,input,'rescue-owner',()=>{})).toThrow(IssueTransferActiveDestinationError);
  expect(ledger.read(value.requestId)).toEqual(before);expect(ledger.readCancellation(value.requestId)).toBeUndefined();
  expect(db.query('SELECT request_id,document FROM issue_transfer_locks WHERE issue_number=1').get()).toEqual(lock);
  expect(db.query('SELECT cancel_id FROM issue_transfer_cancel_requests').all()).toEqual([]);
 }finally{db.close();}
});

test('legacy transfer reservations upgrade only with room before cancellation intent or destination fence',()=>{
 for(const location of ['source','destination'] as const){
  const db=new Database(':memory:');
  const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(operation:()=>T){return db.transaction(operation)();}} as unknown as DurableObjectStorage;
  try{
   let ledger=new IssueTransferLedger(storage);const value=manifest();
   if(location==='source')ledger.freeze(value,()=>{});else ledger.reserve(value,()=>8,()=>{});
   const legacy=new TextEncoder().encode(JSON.stringify(value)).length*4+8192;
   db.query('UPDATE issue_transfer_capacity SET bytes=? WHERE request_id=?').run(legacy,value.requestId);
   const filler=crypto.randomUUID();db.query('INSERT INTO issue_transfer_capacity VALUES(?,?)').run(filler,128*1024*1024-legacy-1);
   ledger=new IssueTransferLedger(storage);
   const before=ledger.read(value.requestId),locks=db.query('SELECT issue_number,request_id,document FROM issue_transfer_locks').all();
   const input={requestId:value.requestId,cancelId:crypto.randomUUID(),expectedManifestDigest:value.previewDigest,expectedDestinationIncarnation:value.destination.incarnation,confirmed:true as const};
   expect(()=>location==='source'?ledger.beginCancellation(value.requestId,input,'owner',()=>{}):ledger.cancelDestination(value,input,'owner',()=>{})).toThrow('storage capacity');
   expect(ledger.read(value.requestId)).toEqual(before);expect(ledger.readCancellation(value.requestId)).toBeUndefined();
   expect(db.query('SELECT issue_number,request_id,document FROM issue_transfer_locks').all()).toEqual(locks);
   expect(db.query('SELECT bytes FROM issue_transfer_capacity WHERE request_id=?').get(value.requestId)).toEqual({bytes:legacy});
   expect(db.query('SELECT cancel_id FROM issue_transfer_cancel_requests').all()).toEqual([]);
   if(location==='destination'){
    const absent=manifest(),absentInput={...input,requestId:absent.requestId,cancelId:crypto.randomUUID(),expectedManifestDigest:absent.previewDigest,expectedDestinationIncarnation:absent.destination.incarnation};
    expect(()=>ledger.cancelDestination(absent,absentInput,'owner',()=>{})).toThrow('storage capacity');
    expect(ledger.readCancellation(absent.requestId)).toBeUndefined();
    expect(db.query('SELECT request_id FROM issue_transfer_capacity WHERE request_id=?').all(absent.requestId)).toEqual([]);
   }
   db.query('DELETE FROM issue_transfer_capacity WHERE request_id=?').run(filler);
   expect(location==='source'?ledger.beginCancellation(value.requestId,input,'owner',()=>{}).phase:ledger.cancelDestination(value,input,'owner',()=>{}).phase).toBe(location==='source'?'cancelling':'cancelled');
   expect(db.query('SELECT bytes FROM issue_transfer_capacity WHERE request_id=?').get(value.requestId)).toEqual({bytes:new TextEncoder().encode(JSON.stringify(value)).length*7+16384});
  }finally{db.close();}
 }
});

test('unfrozen cancellation permanently fences original confirmation without inventing a manifest or lock',()=>{
 const db=new Database(':memory:');
 const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(operation:()=>T){return db.transaction(operation)();}} as unknown as DurableObjectStorage;
 try{
  const ledger=new IssueTransferLedger(storage),value=manifest(),scope={projectId:value.source.projectId,incarnation:value.source.incarnation,number:value.source.number,createdAt:value.source.createdAt,author:value.source.author};
  const originalRequest={destinationProjectId:value.destination.projectId,expectedRevision:0,requestId:value.requestId,confirmed:true as const,expectedManifestDigest:value.previewDigest,expectedDestinationIncarnation:value.destination.incarnation};
  const input={requestId:value.requestId,cancelId:crypto.randomUUID(),expectedManifestDigest:value.previewDigest,expectedDestinationIncarnation:value.destination.incarnation,confirmed:true as const,originalRequest};
  const saved=ledger.cancelUnfrozen(scope,input,'rescue-owner',()=>{});expect(saved?.phase).toBe('cancelled');expect(ledger.read(value.requestId)).toBeUndefined();expect(()=>ledger.assertWritable(1)).not.toThrow();
  expect(ledger.cancelUnfrozen(scope,input,'rescue-owner',()=>{})).toEqual(saved);
  expect(()=>ledger.freeze(value,()=>{})).toThrow('cancelled');
  expect(()=>ledger.cancelUnfrozen(scope,{...input,originalRequest:{...originalRequest,destinationProjectId:'changed-destination'}},'rescue-owner',()=>{})).toThrow('cannot change');
  expect(db.query('SELECT request_id FROM issue_transfer_locks').all()).toEqual([]);
  const fresh={...value,requestId:crypto.randomUUID()};ledger.freeze(fresh,()=>{});
  expect(ledger.cancelUnfrozen(scope,{...input,requestId:fresh.requestId,cancelId:crypto.randomUUID(),originalRequest:{...originalRequest,requestId:fresh.requestId}},'rescue-owner',()=>{})).toBeUndefined();
  db.query('INSERT INTO issue_transfer_capacity VALUES(?,?)').run(crypto.randomUUID(),128*1024*1024);
  const rejectedId=crypto.randomUUID(),rejected={...input,requestId:rejectedId,cancelId:crypto.randomUUID(),originalRequest:{...originalRequest,requestId:rejectedId}};
  expect(()=>ledger.cancelUnfrozen(scope,rejected,'rescue-owner',()=>{})).toThrow('storage capacity');
  expect(ledger.readUnfrozenCancellation(rejectedId)).toBeUndefined();expect(db.query('SELECT request_id FROM issue_transfer_capacity WHERE request_id=?').all(rejectedId)).toEqual([]);
 }finally{db.close();}
});

test('frozen cancellation rejects an original confirmation with changed destination or revision',()=>{
 const db=new Database(':memory:');
 const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(operation:()=>T){return db.transaction(operation)();}} as unknown as DurableObjectStorage;
 try{
  const ledger=new IssueTransferLedger(storage),value=manifest();ledger.freeze(value,()=>{});
  const originalRequest={destinationProjectId:value.destination.projectId,expectedRevision:0,requestId:value.requestId,confirmed:true as const,expectedManifestDigest:value.previewDigest,expectedDestinationIncarnation:value.destination.incarnation};
  const input={requestId:value.requestId,cancelId:crypto.randomUUID(),expectedManifestDigest:value.previewDigest,expectedDestinationIncarnation:value.destination.incarnation,confirmed:true as const,originalRequest};
  expect(()=>ledger.beginCancellation(value.requestId,{...input,originalRequest:{...originalRequest,expectedRevision:1}},'owner',()=>{})).toThrow('does not match frozen');
  expect(()=>ledger.beginCancellation(value.requestId,{...input,originalRequest:{...originalRequest,destinationProjectId:'other'}},'owner',()=>{})).toThrow('does not match frozen');
  expect(ledger.readCancellation(value.requestId)).toBeUndefined();expect(ledger.read(value.requestId)?.phase).toBe('frozen');
 }finally{db.close();}
});

test('frozen cancellation normalizes omitted and included authoritative confirmation for immutable replay',()=>{
 const db=new Database(':memory:');
 const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(operation:()=>T){return db.transaction(operation)();}} as unknown as DurableObjectStorage;
 try{
  const ledger=new IssueTransferLedger(storage),value=manifest();ledger.freeze(value,()=>{});
  const input={requestId:value.requestId,cancelId:crypto.randomUUID(),expectedManifestDigest:value.previewDigest,expectedDestinationIncarnation:value.destination.incarnation,confirmed:true as const};
  const normalized=normalizeIssueTransferCancellation(value,input);
  expect(normalized.originalRequest).toMatchObject({destinationProjectId:value.destination.projectId,expectedRevision:value.source.stateRevision,requestId:value.requestId});
  const first=ledger.beginCancellation(value.requestId,input,'owner',()=>{});
  expect(first.input).toEqual(normalized);expect(ledger.beginCancellation(value.requestId,normalized,'owner',()=>{})).toEqual(first);
  expect(ledger.beginCancellation(value.requestId,input,'owner',()=>{})).toEqual(first);
 }finally{db.close();}
});

test('administrator finalization retains original transfer attribution and requires positive completion without redispatch',()=>{
 const db=new Database(':memory:');
 const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(operation:()=>T){return db.transaction(operation)();}} as unknown as DurableObjectStorage;
 try{
  const ledger=new IssueTransferLedger(storage),value=manifest();ledger.freeze(value,()=>{});
  const input={requestId:value.requestId,finalizeId:crypto.randomUUID(),expectedManifestDigest:value.previewDigest,expectedDestinationIncarnation:value.destination.incarnation,destinationNumber:8,confirmed:true as const};
  const first=ledger.beginFinalization(value.requestId,input,'rescue-owner',()=>{});expect(first.phase).toBe('prepared');expect(first.actorId).toBe('rescue-owner');expect(first.manifest.actorId).toBe('owner');
  expect(ledger.beginFinalization(value.requestId,input,'rescue-owner',()=>{})).toEqual(first);
  expect(()=>ledger.beginFinalization(value.requestId,{...input,destinationNumber:9},'rescue-owner',()=>{})).toThrow('payload cannot change');
  expect(()=>ledger.markFinalizationSourceCompleted(value.requestId,input.finalizeId,'rescue-owner',()=>{})).toThrow('source completion');
  expect(ledger.readFinalization(value.requestId,input.finalizeId,'rescue-owner')?.phase).toBe('prepared');
  ledger.bindDestination(value.requestId,8,()=>{});ledger.complete(value.requestId,()=>{});
  expect(ledger.markFinalizationSourceCompleted(value.requestId,input.finalizeId,'rescue-owner',()=>{}).phase).toBe('source-completed');
  expect(()=>ledger.completeFinalization(value.requestId,input.finalizeId,'rescue-owner',()=>{throw Error('Destination finalization is unconfirmed');})).toThrow('unconfirmed');
  expect(ledger.readFinalization(value.requestId,input.finalizeId,'rescue-owner')?.phase).toBe('source-completed');
  expect(ledger.completeFinalization(value.requestId,input.finalizeId,'rescue-owner',()=>{}).phase).toBe('completed');
  expect(ledger.completeFinalization(value.requestId,input.finalizeId,'rescue-owner',()=>{}).manifest.actorId).toBe('owner');
  expect(db.query('SELECT request_id FROM issue_transfer_incoming').all()).toEqual([]);expect(db.query('SELECT request_id FROM issue_transfer_copy_attempts').all()).toEqual([]);
  expect(db.query('SELECT COUNT(*) AS count FROM issue_transfer_finalizations').get()).toEqual({count:1});
 }finally{db.close();}
});

test('finalization cannot bypass pending cancellation or consume an unreserved recovery budget',()=>{
 const db=new Database(':memory:');
 const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(operation:()=>T){return db.transaction(operation)();}} as unknown as DurableObjectStorage;
 try{
  const ledger=new IssueTransferLedger(storage),value=manifest();ledger.freeze(value,()=>{});
  const input={requestId:value.requestId,finalizeId:crypto.randomUUID(),expectedManifestDigest:value.previewDigest,expectedDestinationIncarnation:value.destination.incarnation,destinationNumber:8,confirmed:true as const};
  const cancellation={requestId:value.requestId,cancelId:crypto.randomUUID(),expectedManifestDigest:value.previewDigest,expectedDestinationIncarnation:value.destination.incarnation,confirmed:true as const};ledger.beginCancellation(value.requestId,cancellation,'owner',()=>{});
  expect(()=>ledger.beginFinalization(value.requestId,input,'rescue-owner',()=>{})).toThrow('pending');expect(ledger.readFinalization(value.requestId,input.finalizeId,'rescue-owner')).toBeUndefined();
  ledger.denyCancellationActive(value.requestId,cancellation.cancelId,()=>{});
  db.query('INSERT INTO issue_transfer_capacity VALUES(?,?)').run(crypto.randomUUID(),128*1024*1024);
  expect(()=>ledger.beginFinalization(value.requestId,input,'rescue-owner',()=>{})).toThrow('audit capacity');
  expect(ledger.read(value.requestId)?.phase).toBe('frozen');expect(db.query('SELECT finalize_id FROM issue_transfer_finalizations').all()).toEqual([]);
 }finally{db.close();}
});

test('destination provenance records its actual first finisher and never relabels a finalized replay',()=>{
 for(const recovery of [false,true]){
  const db=new Database(':memory:');
  const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(operation:()=>T){return db.transaction(operation)();}} as unknown as DurableObjectStorage;
  try{
   const ledger=new IssueTransferLedger(storage),value={...manifest(),attachments:[]};ledger.reserve(value,()=>8,()=>{});ledger.markReady(value.requestId,()=>true,()=>{});ledger.activate(value.requestId,()=>true,()=>{});
   const finalizeId=crypto.randomUUID(),first=ledger.finishDestination(value.requestId,()=>{},recovery?{actorId:'first-rescue-owner',finalizeId}:undefined);
   expect(first.destinationFinalization).toEqual(recovery?{actorId:'first-rescue-owner',requestId:value.requestId,finalizeId}:{actorId:value.actorId,requestId:value.requestId});
   const replay=ledger.finishDestination(value.requestId,()=>{},{actorId:'later-rescue-owner',finalizeId:crypto.randomUUID()});expect(replay.destinationFinalization).toEqual(first.destinationFinalization);
   expect(replay.manifest.actorId).toBe(value.actorId);expect(()=>ledger.assertWritable(8)).not.toThrow();
  }finally{db.close();}
 }
});

test('hidden destination cancellation wins late readiness and copy attempts without deleting retained rows',()=>{
 const db=new Database(':memory:');
 const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(operation:()=>T){return db.transaction(operation)();}} as unknown as DurableObjectStorage;
 try{
  const ledger=new IssueTransferLedger(storage),value=manifest();ledger.reserve(value,()=>8,()=>{});
  const input={requestId:value.requestId,cancelId:crypto.randomUUID(),expectedManifestDigest:value.previewDigest,expectedDestinationIncarnation:value.destination.incarnation,confirmed:true as const};
  ledger.cancelDestination(value,input,'owner',()=>{});
  expect(()=>ledger.markReady(value.requestId,()=>true,()=>{})).toThrow('cancelled');expect(()=>ledger.activate(value.requestId,()=>true,()=>{})).toThrow('cancelled');
  expect(()=>ledger.beginCopy(value.requestId,value.attachments[0]!.id,crypto.randomUUID(),()=>{})).toThrow('cancelled');
  expect(db.query('SELECT active FROM issue_transfer_incoming WHERE issue_number=8').get()).toEqual({active:0});
  expect(ledger.read(value.requestId)?.phase).toBe('cancelled');
 }finally{db.close();}
});
test('transfer copy retries retain original nonce and never authorize a second dispatch after durable restart',()=>{
 const db=new Database(':memory:');
 const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(operation:()=>T){return db.transaction(operation)();}} as unknown as DurableObjectStorage;
 try{
  let ledger=new IssueTransferLedger(storage);const value=manifest();let allocations=0;
  ledger.reserve(value,()=>{allocations++;return 8;},()=>{});
  ledger.reserve(value,()=>{allocations++;return 9;},()=>{});expect(allocations).toBe(1);
  expect(()=>ledger.reserve({...value,issue:{...value.issue,body:'Changed request content'}},()=>{allocations++;return 9;},()=>{})).toThrow('cannot change');expect(allocations).toBe(1);
  const sameId=manifest();sameId.attachments[0]!.destinationId=sameId.attachments[0]!.id;
  expect(()=>ledger.reserve(sameId,()=>9,()=>{})).toThrow('must be distinct');
  const crossed=manifest();crossed.attachments.push({...crossed.attachments[0]!,id:crossed.attachments[0]!.destinationId,destinationId:crypto.randomUUID()});
  expect(()=>ledger.reserve(crossed,()=>9,()=>{})).toThrow('must be distinct');
  const excess=manifest();excess.features={text:'x'.repeat(2*1024*1024)};
  expect(()=>ledger.reserve(excess,()=>9,()=>{})).toThrow('manifest capacity');
  const attachment=value.attachments[0]!,nonce=crypto.randomUUID();
  expect(ledger.beginCopy(value.requestId,attachment.id,nonce,()=>{})).toEqual({nonce,phase:'issued',newlyIssued:true});
  ledger=new IssueTransferLedger(storage);
  expect(ledger.beginCopy(value.requestId,attachment.id,nonce,()=>{})).toEqual({nonce,phase:'issued',newlyIssued:false});
  expect(()=>ledger.beginCopy(value.requestId,attachment.id,crypto.randomUUID(),()=>{})).toThrow('nonce cannot change');
  ledger.markCopyUnknown(value.requestId,attachment.id,nonce,()=>{});
  expect(ledger.beginCopy(value.requestId,attachment.id,nonce,()=>{})).toEqual({nonce,phase:'unknown',newlyIssued:false});
  expect(()=>ledger.markCopyVerified(value.requestId,attachment.id,crypto.randomUUID(),()=>{})).toThrow('ownership changed');
  expect(()=>ledger.markReady(value.requestId,()=>false,()=>{})).toThrow('not fully verified');
  expect(()=>ledger.markReady(value.requestId,()=>true,()=>{})).toThrow('not fully verified');
  expect(()=>ledger.assertWritable(8)).toThrow('transfer is in progress');
  ledger.markCopyVerified(value.requestId,attachment.id,nonce,()=>{});ledger.markReady(value.requestId,()=>true,()=>{});ledger.activate(value.requestId,()=>true,()=>{});
  expect(()=>ledger.assertWritable(8)).toThrow('transfer is in progress');
  expect(()=>ledger.finishDestination(value.requestId,()=>{throw Error('Source completion is unconfirmed');})).toThrow('unconfirmed');
  expect(()=>ledger.assertWritable(8)).toThrow('transfer is in progress');
  expect(ledger.finishDestination(value.requestId,()=>{}).finalized).toBe(true);expect(()=>ledger.assertWritable(8)).not.toThrow();
  db.query('INSERT INTO issue_transfer_capacity VALUES(?,?)').run(crypto.randomUUID(),128*1024*1024);
  const full=manifest();
  expect(()=>ledger.reserve(full,()=>{allocations++;return 9;},()=>{})).toThrow('storage capacity');expect(allocations).toBe(1);
  expect(()=>ledger.lock(full,()=>{})).toThrow('storage capacity');
  expect(db.query('SELECT request_id FROM issue_transfer_locks WHERE request_id=?').all(full.requestId)).toEqual([]);
  expect(db.query('SELECT issue_number FROM issue_transfer_incoming WHERE request_id=?').all(full.requestId)).toEqual([]);
 }finally{db.close();}
});
