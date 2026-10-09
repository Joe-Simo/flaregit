import {createHash} from 'node:crypto';
import type {LfsObjectRef} from '../core/git-lfs';

export const LFS_HTTP_OBJECT_BYTES=100*1024*1024;
export const LFS_REPOSITORY_QUOTA_BYTES=1024*1024*1024;
export interface LfsScope {projectId:string;incarnation:string}
export interface LfsEntry extends LfsObjectRef {key:string;stageKey:string;phase:'pending'|'verified'}
interface LfsWriteRecord {key:string;writeId:string;oid:string;size:number;phase:'issued'|'settled'|'rejected'|'unknown';emittedBytes?:number;producerClosed?:boolean;writeSettled?:boolean;result?:'stored'|'refused'}
export class LfsStorageError extends Error {constructor(message:string,readonly status:number){super(message);}}
/** Repository-local durable reservations count against quota before accepting any bytes. */
export class DurableLfsStore {
 private readonly active=new Set<string>();
 private readonly objectsTable:string;private readonly writesTable:string;private readonly objectPrefix:string;private readonly objectLimit:number;private readonly quotaLimit:number;

 constructor(private readonly storage:DurableObjectStorage,profile:'lfs'|'issue-attachments'='lfs'){if(profile!=='lfs'&&profile!=='issue-attachments')throw new LfsStorageError('Invalid binary storage profile',400);this.objectsTable=profile==='lfs'?'lfs_objects':'issue_attachment_blobs';this.writesTable=profile==='lfs'?'lfs_writes':'issue_attachment_blob_writes';this.objectPrefix=profile==='lfs'?'lfs':'issue-attachment-blobs';this.objectLimit=profile==='lfs'?LFS_HTTP_OBJECT_BYTES:5*1024*1024;this.quotaLimit=profile==='lfs'?LFS_REPOSITORY_QUOTA_BYTES:64*1024*1024;storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${this.writesTable}(key TEXT PRIMARY KEY,state TEXT NOT NULL)`);storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${this.objectsTable}(incarnation TEXT NOT NULL,oid TEXT NOT NULL,size INTEGER NOT NULL,key TEXT NOT NULL,stage_key TEXT NOT NULL,phase TEXT NOT NULL,PRIMARY KEY(incarnation,oid))`);}
 get(scope:LfsScope,oid:string):LfsEntry|undefined{return this.storage.sql.exec<{oid:string;size:number;key:string;stage_key:string;phase:'pending'|'verified'}>(`SELECT * FROM ${this.objectsTable} WHERE incarnation=? AND oid=?`,scope.incarnation,oid).toArray().map(row=>({oid:row.oid,size:row.size,key:row.key,stageKey:row.stage_key,phase:row.phase}))[0];}
 private reserve(scope:LfsScope,object:LfsObjectRef):LfsEntry {
  if(!/^[a-f0-9]{64}$/.test(object.oid)||!Number.isSafeInteger(object.size)||object.size<0||object.size>this.objectLimit)throw new LfsStorageError('Invalid LFS object identity or size',413);
  return this.storage.transactionSync(()=>{const previous=this.get(scope,object.oid);if(previous){if(previous.size!==object.size)throw new LfsStorageError('LFS object identity is immutable',409);return previous;}
   const usage=this.storage.sql.exec<{count:number;bytes:number;pending:number}>(`SELECT COUNT(*) AS count,COALESCE(SUM(CASE WHEN phase='pending' THEN size*2 ELSE size END),0) AS bytes,COALESCE(SUM(CASE WHEN phase='pending' THEN 1 ELSE 0 END),0) AS pending FROM ${this.objectsTable}`).toArray()[0]!;
   if(usage.count>=1000||usage.pending>=8||usage.bytes+object.size*2>this.quotaLimit)throw new LfsStorageError('Repository LFS quota or active upload capacity reached',413);
   const prefix=`${this.objectPrefix}/${encodeURIComponent(scope.projectId)}/${encodeURIComponent(scope.incarnation)}`;
   const entry:LfsEntry={...object,key:this.objectPrefix==='lfs'?`${prefix}/objects/${object.oid}`:`${prefix}/objects/${object.oid}/${crypto.randomUUID()}`,stageKey:`${prefix}/pending/${object.oid}/${crypto.randomUUID()}`,phase:'pending'};
   this.storage.sql.exec(`INSERT INTO ${this.objectsTable} VALUES(?,?,?,?,?,?)`,scope.incarnation,entry.oid,entry.size,entry.key,entry.stageKey,entry.phase);return entry;
  });
 }
 admitObject(scope:LfsScope,object:LfsObjectRef):LfsEntry{if(this.active.has(scope.incarnation+':'+object.oid))throw new LfsStorageError('Original binary operation is active; retry admission after it settles',409);return this.reserve(scope,object);}
 async upload(scope:LfsScope,object:LfsObjectRef,stream:ReadableStream<Uint8Array>,bucket:R2Bucket,authorize:()=>Promise<void>,onInputValidated?:()=>void):Promise<{stored:boolean}> {
  await authorize();const entry=this.reserve(scope,object),identity=scope.incarnation+':'+object.oid;
  if(this.active.has(identity))throw new LfsStorageError('An upload for this object is already active',409);
  this.active.add(identity);
  try{
   await this.reconcileEntryWrites(entry,bucket);
   if(this.storage.sql.exec(`SELECT key FROM ${this.writesTable} WHERE key IN (?,?)`,entry.key,entry.stageKey).toArray().length)throw new LfsStorageError('An earlier LFS storage write is unconfirmed; admission remains reserved',409);
   if(entry.phase==='verified'){await this.checkStream(stream,entry,authorize,onInputValidated);await authorize();const stored=await bucket.head(entry.key);if(!stored||stored.size!==entry.size||stored.customMetadata?.oid!==entry.oid)throw new LfsStorageError('Verified LFS storage is unavailable',503);await this.cleanupStage(bucket,entry);return{stored:false};}
   // An interrupted request may have persisted bytes before its durable final marker.
   const existing=await bucket.get(entry.key);
   if(existing){await this.checkStream(stream,entry,authorize,onInputValidated);await this.checkStream(existing.body,entry,authorize);await authorize();await this.cleanupStage(bucket,entry);await authorize();this.markVerified(scope,entry);return{stored:false};}
   await bucket.delete(entry.stageKey);if(await bucket.head(entry.stageKey))throw new LfsStorageError('Previous upload cleanup is unconfirmed',503);
   await this.putStream(bucket,entry,entry.stageKey,stream,authorize,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{oid:entry.oid}},onInputValidated);
   await authorize();const stage=await bucket.get(entry.stageKey);if(!stage||stage.size!==entry.size)throw new LfsStorageError('Staged object storage is unconfirmed',503);
   await this.putStream(bucket,entry,entry.key,stage.body,authorize,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/octet-stream'},customMetadata:{oid:entry.oid}});
   const saved=await bucket.get(entry.key);if(!saved)throw new LfsStorageError('Object storage is unconfirmed',503);await this.checkStream(saved.body,entry,authorize);await authorize();await this.cleanupStage(bucket,entry);await authorize();this.markVerified(scope,entry);return{stored:true};
  }catch(error){
   // Quota is released only after both possible R2 outcomes are positively absent.
   try{await this.reconcileEntryWrites(entry,bucket);if(this.storage.sql.exec(`SELECT key FROM ${this.writesTable} WHERE key IN (?,?)`,entry.key,entry.stageKey).toArray().length)throw new LfsStorageError('An LFS write outcome remains unconfirmed',409);await bucket.delete(entry.stageKey);if(!await bucket.head(entry.stageKey)&&!await bucket.head(entry.key))this.storage.sql.exec(`DELETE FROM ${this.objectsTable} WHERE incarnation=? AND oid=? AND key=? AND stage_key=? AND phase='pending'`,scope.incarnation,entry.oid,entry.key,entry.stageKey);}catch{/* Retain the reservation for a bounded retry. */}
   throw error;
  }finally{this.active.delete(identity);}
 }
 async cleanupForDeletion(projectId:string,bucket:R2Bucket){
  if(this.active.size)throw new LfsStorageError('An LFS transfer is still active; retry deletion',409);
  const prefix=`${this.objectPrefix}/${encodeURIComponent(projectId)}/`,rows=this.storage.sql.exec<{key:string;stage_key:string;oid:string;size:number;phase:'pending'|'verified'}>(`SELECT key,stage_key,oid,size,phase FROM ${this.objectsTable} LIMIT 1001`).toArray();
  if(rows.length>1000)throw new LfsStorageError('LFS cleanup inventory exceeds its bound',413);
  const keys=rows.flatMap(row=>[row.key,row.stage_key]);if(keys.some(key=>!key.startsWith(prefix)||key.includes('..')))throw new LfsStorageError('LFS cleanup scope differs',409);
  for(const row of rows)await this.reconcileEntryWrites({...row,stageKey:row.stage_key},bucket);
  if(this.storage.sql.exec(`SELECT key FROM ${this.writesTable} LIMIT 1`).toArray().length)throw new LfsStorageError('An LFS write outcome is still unconfirmed; metadata preserved',409);
  for(const key of keys){await bucket.delete(key);if(await bucket.head(key))throw new LfsStorageError('LFS object deletion remains unconfirmed',503);}
  const remaining=await bucket.list({prefix,limit:1});if(remaining.objects.length||remaining.truncated)throw new LfsStorageError('LFS storage cleanup is incomplete; metadata preserved',503);
  this.storage.sql.exec(`DELETE FROM ${this.objectsTable}`);
 }
 private async cleanupStage(bucket:R2Bucket,entry:LfsEntry){await bucket.delete(entry.stageKey);if(await bucket.head(entry.stageKey))throw new LfsStorageError('Staged LFS cleanup is unconfirmed',503);}
 private saveWrite(record:LfsWriteRecord){const previous=this.storage.sql.exec<{state:string}>(`SELECT state FROM ${this.writesTable} WHERE key=?`,record.key).toArray()[0];if(!previous)return;try{const saved=JSON.parse(previous.state) as Partial<LfsWriteRecord>;if(saved.writeId!==record.writeId)return;}catch{return;}this.storage.sql.exec(`UPDATE ${this.writesTable} SET state=? WHERE key=? AND state=?`,JSON.stringify(record),record.key,previous.state);}
 private clearWrite(record:LfsWriteRecord){const previous=this.storage.sql.exec<{state:string}>(`SELECT state FROM ${this.writesTable} WHERE key=?`,record.key).toArray()[0];if(!previous)return;try{if((JSON.parse(previous.state) as Partial<LfsWriteRecord>).writeId!==record.writeId)return;}catch{return;}this.storage.sql.exec(`DELETE FROM ${this.writesTable} WHERE key=? AND state=?`,record.key,previous.state);}
 private async putStream(bucket:R2Bucket,entry:LfsEntry,key:string,body:ReadableStream<Uint8Array>,authorize:()=>Promise<void>,options:R2PutOptions,onInputValidated?:()=>void){
  if(entry.size===0){if(entry.oid!==createHash('sha256').digest('hex'))throw new LfsStorageError('Empty LFS object oid does not match SHA-256',422);await this.checkStream(body,entry,authorize,onInputValidated);}
  const record:LfsWriteRecord={key,writeId:crypto.randomUUID(),oid:entry.oid,size:entry.size,phase:'issued',emittedBytes:0};
  this.storage.sql.exec(`INSERT INTO ${this.writesTable} VALUES(?,?)`,key,JSON.stringify(record));
  const fixed=entry.size===0?undefined:new FixedLengthStream(entry.size),abort=new AbortController();let producerRejected=false,pumpSettled=entry.size===0,writeSettled=false,refused=false,timer:ReturnType<typeof setTimeout>|undefined;
  const update=()=>{record.producerClosed=pumpSettled;record.writeSettled=writeSettled;record.phase=producerRejected&&pumpSettled&&writeSettled&&(record.emittedBytes??entry.size)<entry.size?'rejected':writeSettled&&record.result?'settled':'unknown';this.saveWrite(record);};
  const validated=fixed?this.checkedStream(body,entry,authorize,error=>{producerRejected=error instanceof LfsStorageError&&[401,403,404,413,422].includes(error.status);},bytes=>{record.emittedBytes=(record.emittedBytes??0)+bytes;},onInputValidated):undefined;
  const pumping=(fixed&&validated?validated.pipeTo(fixed.writable,{signal:abort.signal}):Promise.resolve()).then(()=>{pumpSettled=true;},error=>{pumpSettled=true;if(writeSettled)update();throw error;});
  const writing=bucket.put(key,fixed?fixed.readable:new Uint8Array(0),{...options,customMetadata:{...options.customMetadata,oid:entry.oid,lfsWriteId:record.writeId}}).then(object=>{writeSettled=true;record.result=object===null?'refused':'stored';if(object===null){refused=true;abort.abort();}update();return object;},error=>{writeSettled=true;update();throw error;});
  const finished=Promise.all([writing,pumping.catch(error=>{if(!refused)throw error;})]);
  try{await Promise.race([finished,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new LfsStorageError('LFS storage write timed out; its admission remains reserved',503));},300000);})]);this.clearWrite(record);}
  catch(error){abort.abort();let settlementTimer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([Promise.allSettled([pumping,writing]),new Promise<void>(resolve=>{settlementTimer=setTimeout(resolve,5000);})]);}finally{if(settlementTimer!==undefined)clearTimeout(settlementTimer);}update();throw error;}
  finally{if(timer!==undefined)clearTimeout(timer);}
 }
 /** A visible owned nonce is a positive receipt that this exact atomic PUT has
  * completed. Absence never resolves an issued/unknown write or releases its hold. */
 private async boundedStorage<T>(operation:Promise<T>,deadline:number):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new LfsStorageError('LFS reconciliation reached its deadline; holds remain reserved',503)),Math.max(1,deadline-Date.now()));})]);}finally{if(timer!==undefined)clearTimeout(timer);}}
 private async reconcileEntryWrites(entry:LfsEntry,bucket:R2Bucket,beforeDelete?:(key:string)=>Promise<void>,afterDelete?:(key:string)=>void){
  const deadline=Date.now()+30000;
  const rows=this.storage.sql.exec<{key:string;state:string}>(`SELECT key,state FROM ${this.writesTable} WHERE key IN (?,?)`,entry.stageKey,entry.key).toArray();
  for(const row of rows){let record:LfsWriteRecord;try{record=JSON.parse(row.state) as LfsWriteRecord;}catch{continue;}
   if(record.key!==row.key||record.oid!==entry.oid||record.size!==entry.size||! /^[a-f0-9-]{36}$/.test(record.writeId)||!['issued','settled','rejected','unknown'].includes(record.phase))continue;
   if(record.phase==='settled'&&record.result==='refused'){this.clearWrite(record);continue;}
   const object=await this.boundedStorage(bucket.get(record.key),deadline),confirmed=record.phase==='settled'||record.phase==='rejected'&&record.producerClosed===true&&record.writeSettled===true&&Number.isSafeInteger(record.emittedBytes)&&record.emittedBytes!>=0&&record.emittedBytes!<record.size;
   if(!object){if(confirmed)this.clearWrite(record);continue;}
   if(object.customMetadata?.lfsWriteId!==record.writeId||object.customMetadata?.oid!==entry.oid){await object.body.cancel();continue;}
   // Only unpublished objects may be reconciled destructively. A final object
   // that passes readback stays available for a currently authorized retry.
   const valid=object.size===entry.size&&await this.readbackMatches(object.body,entry,deadline);
   if(object.size!==entry.size)await object.body.cancel();
   if(record.key===entry.stageKey||!valid){if(entry.phase==='verified'&&record.key===entry.key)throw new LfsStorageError('Verified LFS content needs integrity recovery',503);await beforeDelete?.(record.key);await this.boundedStorage(bucket.delete(record.key),deadline);afterDelete?.(record.key);if(await this.boundedStorage(bucket.head(record.key),deadline))continue;}
   this.clearWrite(record);
  }
 }
 private async readbackMatches(stream:ReadableStream<Uint8Array>,object:LfsObjectRef,deadline:number):Promise<boolean>{
  const reader=stream.getReader(),hash=createHash('sha256');let size=0;
  try{for(;;){let timer:ReturnType<typeof setTimeout>|undefined;const next=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new LfsStorageError('LFS reconciliation readback reached its deadline',503)),Math.max(1,deadline-Date.now()));})]).finally(()=>{if(timer!==undefined)clearTimeout(timer);});if(next.done)return size===object.size&&hash.digest('hex')===object.oid;size+=next.value.byteLength;if(size>object.size||size>this.objectLimit)return false;hash.update(next.value);}}
  finally{await this.boundedStorage(reader.cancel(),deadline).catch(()=>{});reader.releaseLock();}
 }
 /** Metadata-only observation; absence never clears an unknown writer. */
 cleanupState(scope:LfsScope,oid:string){
  if(!/^[a-f0-9]{64}$/.test(oid))throw new LfsStorageError('Invalid binary cleanup identity',400);
  const prefix=`${this.objectPrefix}/${encodeURIComponent(scope.projectId)}/${encodeURIComponent(scope.incarnation)}`,rows=this.storage.sql.exec<{key:string;state:string}>(`SELECT key,state FROM ${this.writesTable} LIMIT 2001`).toArray();if(rows.length>2000)throw new LfsStorageError('Binary write inspection exceeds its bound',413);
  let pendingWrites=0;for(const row of rows){if(row.key.startsWith(`${prefix}/pending/${oid}/`)||row.key===`${prefix}/objects/${oid}`||row.key.startsWith(`${prefix}/objects/${oid}/`))pendingWrites++;}
  return{objectPresent:Boolean(this.get(scope,oid)),pendingWrites,activeTransfer:this.active.has(scope.incarnation+':'+oid)};
 }
 async reconcile(scope:LfsScope,oid:string,bucket:R2Bucket){const identity=scope.incarnation+':'+oid;if(this.active.has(identity))throw new LfsStorageError('LFS reconciliation requires the transfer to stop',409);this.active.add(identity);try{const entry=this.get(scope,oid);if(!entry)return{reconciled:true};await this.reconcileEntryWrites(entry,bucket);const pending=this.storage.sql.exec(`SELECT key FROM ${this.writesTable} WHERE key IN (?,?)`,entry.key,entry.stageKey).toArray().length;if(!pending&&!await bucket.head(entry.stageKey)&&!await bucket.head(entry.key))this.storage.sql.exec(`DELETE FROM ${this.objectsTable} WHERE incarnation=? AND oid=? AND key=? AND stage_key=? AND phase='pending'`,scope.incarnation,oid,entry.key,entry.stageKey);return{reconciled:pending===0};}finally{this.active.delete(identity);}}
 async confirm(scope:LfsScope,oid:string,bucket:R2Bucket,authorize:()=>Promise<void>){const identity=scope.incarnation+':'+oid;if(this.active.has(identity))throw new LfsStorageError('Binary transfer is still active',409);this.active.add(identity);try{await authorize();const entry=this.get(scope,oid);if(!entry)return false;await this.reconcileEntryWrites(entry,bucket);if(this.storage.sql.exec(`SELECT key FROM ${this.writesTable} WHERE key IN (?,?)`,entry.key,entry.stageKey).toArray().length)return false;const object=await bucket.get(entry.key);if(!object)return false;if(object.size!==entry.size)throw new LfsStorageError('Binary storage size differs',422);await this.checkStream(object.body,entry,authorize);await authorize();await this.cleanupStage(bucket,entry);await authorize();this.markVerified(scope,entry);return true;}finally{this.active.delete(identity);}}
 async retire(scope:LfsScope,oid:string,bucket:R2Bucket,beforeDelete?:(key:string)=>Promise<void>,afterDelete?:(key:string)=>void){const identity=scope.incarnation+':'+oid;if(this.active.has(identity))throw new LfsStorageError('Binary transfer must stop before retention cleanup',409);this.active.add(identity);try{const entry=this.get(scope,oid);if(!entry)return;await this.reconcileEntryWrites(entry,bucket,beforeDelete,afterDelete);if(this.storage.sql.exec(`SELECT key FROM ${this.writesTable} WHERE key IN (?,?)`,entry.key,entry.stageKey).toArray().length)throw new LfsStorageError('Binary write completion is unconfirmed; retention hold preserved',409);for(const key of [entry.stageKey,entry.key]){await beforeDelete?.(key);await bucket.delete(key);afterDelete?.(key);if(await bucket.head(key))throw new LfsStorageError('Binary retention deletion is unconfirmed',503);}this.storage.sql.exec(`DELETE FROM ${this.objectsTable} WHERE incarnation=? AND oid=? AND key=? AND stage_key=?`,scope.incarnation,oid,entry.key,entry.stageKey);}finally{this.active.delete(identity);}}
 private markVerified(scope:LfsScope,entry:LfsEntry){this.storage.transactionSync(()=>{const current=this.get(scope,entry.oid);if(!current||current.key!==entry.key||current.stageKey!==entry.stageKey||current.size!==entry.size)throw new LfsStorageError('LFS admission changed',409);this.storage.sql.exec(`UPDATE ${this.objectsTable} SET phase='verified' WHERE incarnation=? AND oid=? AND key=? AND stage_key=?`,scope.incarnation,entry.oid,entry.key,entry.stageKey);});}
 private checkedStream(stream:ReadableStream<Uint8Array>,object:LfsObjectRef,authorize:()=>Promise<void>,onFailure?:(error:unknown)=>void,onEmit?:(bytes:number)=>void,onValidated?:()=>void):ReadableStream<Uint8Array>{
  const maxObjectBytes=this.objectLimit,hash=createHash('sha256');let size=0,tail:Uint8Array|undefined;const reader=stream.getReader();const deadline=Date.now()+300000;
  const timer=setTimeout(()=>{void reader.cancel('LFS transfer timed out');},300000);
  return new ReadableStream<Uint8Array>({async pull(controller){try{
   for(;;){if(Date.now()>deadline)throw new LfsStorageError('LFS transfer timed out',408);await authorize();const next=await reader.read();await authorize();if(Date.now()>deadline)throw new LfsStorageError('LFS transfer timed out',408);
    if(next.done){if(size!==object.size||hash.digest('hex')!==object.oid)throw new LfsStorageError('LFS content does not match its size and SHA-256 oid',422);await authorize();onValidated?.();
     // Until size, hash and the final authority fence pass, at least one chunk
     // remains withheld. No await separates releasing that tail from EOF.
     if(tail){controller.enqueue(tail);onEmit?.(tail.byteLength);tail=undefined;}clearTimeout(timer);controller.close();return;
    }
    size+=next.value.byteLength;if(size>object.size||size>maxObjectBytes)throw new LfsStorageError('LFS size limit exceeded',413);let emitted=false;
    for(let offset=0;offset<next.value.byteLength;offset+=65536){await authorize();const part=next.value.subarray(offset,Math.min(offset+65536,next.value.byteLength));hash.update(part);if(tail){controller.enqueue(tail);onEmit?.(tail.byteLength);emitted=true;}tail=part.slice();}
    if(emitted)return;
   }
  }catch(error){onFailure?.(error);clearTimeout(timer);await reader.cancel().catch(()=>{});controller.error(error);}},async cancel(reason){clearTimeout(timer);await reader.cancel(reason);}});
 }
 private async checkStream(stream:ReadableStream<Uint8Array>,object:LfsObjectRef,authorize:()=>Promise<void>,onValidated?:()=>void){const reader=this.checkedStream(stream,object,authorize,undefined,undefined,onValidated).getReader();for(;;){const next=await reader.read();if(next.done)return;}}
 async download(scope:LfsScope,oid:string,bucket:R2Bucket,authorize:()=>Promise<void>){await authorize();const entry=this.get(scope,oid);if(!entry||entry.phase!=='verified')throw new LfsStorageError('LFS object not found',404);const currentGeneration=async()=>{await authorize();const current=this.get(scope,oid);if(!current||current.phase!=='verified'||current.key!==entry.key||current.stageKey!==entry.stageKey||current.size!==entry.size)throw new LfsStorageError('Original binary download generation changed',403);};await currentGeneration();const stored=await bucket.get(entry.key);if(!stored||stored.size!==entry.size)throw new LfsStorageError('LFS storage is unavailable',503);await currentGeneration();return{size:entry.size,body:this.checkedStream(stored.body,entry,currentGeneration)};}

}
