import {Database} from 'bun:sqlite';
import {expect,test} from 'bun:test';
import {IssueTransferLedger,issueTransferManifestSchema,type IssueTransferManifest} from '../src/server/issue-transfer';
import {canonicalTransferJson} from '../src/server/issue-transfer-api';

function manifest():IssueTransferManifest{return{
 requestId:crypto.randomUUID(),actorId:'owner',previewDigest:'a'.repeat(64),audienceVersion:'repository-members-v1',
 source:{projectId:'source',incarnation:'source-incarnation',number:1,createdAt:'2026-10-08T12:00:00Z',author:'Owner',stateRevision:0},
 destination:{projectId:'destination',incarnation:'destination-incarnation',audienceDigest:'b'.repeat(64),audienceVersion:'repository-members-v1'},
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
