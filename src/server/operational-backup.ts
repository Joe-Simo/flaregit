import {z} from 'zod';

const scopeSchema=z.object({repositoryId:z.string().min(1),canonicalRepository:z.string().min(1),head:z.string().regex(/^[a-f0-9]{40,64}$/).nullable(),acceptedStateHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const cell=z.union([z.string(),z.number().finite(),z.null(),z.object({blob:z.array(z.number().int().min(0).max(255))}).strict()]);
const snapshotSchema=z.object({version:z.literal(1),createdAt:z.string().datetime(),scope:scopeSchema,tables:z.array(z.object({name:z.string().min(1),schema:z.string().min(1),columns:z.array(z.string()),rows:z.array(z.array(cell))}).strict()),indexes:z.array(z.string())}).strict();
export type OperationalSnapshot=z.infer<typeof snapshotSchema>;
export type BackupScope=z.infer<typeof scopeSchema>;
export interface SignedOperationalBackup {snapshot:OperationalSnapshot;sha256:string;signature:string}
/** Implementations must encrypt at rest and restrict retrieval to the repository operator. */
export interface OperationalBackupStore {put(id:string,backup:EncryptedOperationalBackup):Promise<void>;get(id:string):Promise<EncryptedOperationalBackup|null>;delete(id:string):Promise<void>}
const MAX_BYTES=8_000_000;
const quote=(name:string)=>`"${name.replaceAll('"','""')}"`;
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
export async function operationalHash(value:unknown){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))));}
async function key(secret:string){if(new TextEncoder().encode(secret).length<32)throw new Error('Operator backup key must contain at least 32 bytes');return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
function bounded(snapshot:OperationalSnapshot){if(new TextEncoder().encode(JSON.stringify(snapshot)).length>MAX_BYTES)throw new Error('Operational backup exceeds capacity; nothing was truncated');}
/** Full canonical SQL capture, including accepted-state authority. Never use customer archives here. */
export async function captureOperationalBackup(storage:DurableObjectStorage,scope:BackupScope,operatorSecret:string,authorize:()=>void):Promise<SignedOperationalBackup>{
 scopeSchema.parse(scope);
 const snapshot=storage.transactionSync(()=>{
  authorize();
  const objects=storage.sql.exec<{type:string;name:string;sql:string|null}>("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND (name NOT LIKE 'sqlite_%' OR name='sqlite_sequence') AND name NOT LIKE 'operational_%' ORDER BY type,name").toArray();
  if(objects.length>512)throw new Error('Operational snapshot schema exceeds bounded capacity');
  let totalRows=0,totalBytes=0;
  const tables=objects.filter(object=>object.type==='table'&&object.sql).map(object=>{
   const columns=storage.sql.exec<{name:string}>(`PRAGMA table_info(${quote(object.name)})`).toArray().map(column=>column.name);
   if(columns.length===0||columns.length>256)throw new Error('Operational snapshot column capacity exceeded');
   const capacity=storage.sql.exec<{count:number;bytes:number}>(`SELECT COUNT(*) AS count,COALESCE(SUM(${columns.map(column=>`COALESCE(LENGTH(CAST(${quote(column)} AS BLOB)),0)`).join('+')}),0) AS bytes FROM ${quote(object.name)}`).toArray()[0]!;
   totalRows+=capacity.count;totalBytes+=capacity.bytes;
   if(capacity.count>10000||totalRows>50000||totalBytes>MAX_BYTES)throw new Error('Operational snapshot data exceeds bounded capacity');
   const rows=storage.sql.exec(`SELECT ${columns.map(quote).join(',')} FROM ${quote(object.name)}`).toArray().map(row=>columns.map(column=>{const value=row[column];return value instanceof ArrayBuffer?{blob:Array.from(new Uint8Array(value))}:cell.parse(value);}));
   return {name:object.name,schema:object.sql!,columns,rows};
  });
  const value:OperationalSnapshot={version:1,createdAt:new Date().toISOString(),scope,tables,indexes:objects.filter(object=>object.type!=='table'&&object.sql).map(object=>object.sql!)};
  bounded(value);return value;
 });
 await verifyCanonicalScope(snapshot);
 const sha256=await operationalHash(snapshot),signature=hex(await crypto.subtle.sign('HMAC',await key(operatorSecret),new TextEncoder().encode(sha256)));
 authorize();return {snapshot,sha256,signature};
}
/** Trusted operator signatures are checked before SQL executes. Destination must be a new isolated database. */
export async function restoreOperationalBackup(storage:DurableObjectStorage,backup:SignedOperationalBackup,operatorSecret:string,expected:BackupScope,gitVerified:()=>Promise<boolean>,authorize:()=>void){
 const snapshot=snapshotSchema.parse(backup.snapshot);bounded(snapshot);scopeSchema.parse(expected);
 if(JSON.stringify(snapshot.scope)!==JSON.stringify(expected))throw new Error('Recovery scope or accepted state differs');
 const sha256=await operationalHash(snapshot);
 if(sha256!==backup.sha256||!/^([a-f0-9]{2}){32}$/.test(backup.signature))throw new Error('Operational backup digest or signature is invalid');
 const signature=Uint8Array.from(backup.signature.match(/../g)!,part=>parseInt(part,16));
 if(!await crypto.subtle.verify('HMAC',await key(operatorSecret),signature,new TextEncoder().encode(sha256)))throw new Error('Operational backup is not signed by this operator');
 await verifyCanonicalScope(snapshot);
 if(!await gitVerified())throw new Error('Isolated native Git clone has not verified the exact canonical head');
 return storage.transactionSync(()=>{
  authorize();
  if(storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").toArray().length)throw new Error('Recovery destination must be a new isolated database');
  for(const table of snapshot.tables)if(table.name!=='sqlite_sequence')storage.sql.exec(table.schema);
  for(const table of snapshot.tables){for(const row of table.rows){if(row.length!==table.columns.length)throw new Error('Backup row width differs');storage.sql.exec(`INSERT INTO ${quote(table.name)} (${table.columns.map(quote).join(',')}) VALUES (${row.map(()=>'?').join(',')})`,...row.map(value=>typeof value==='object'&&value!==null?Uint8Array.from(value.blob).buffer:value));}}
  for(const index of snapshot.indexes)storage.sql.exec(index);
  for(const table of snapshot.tables){
   const restored=storage.sql.exec(`SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.name)}`).toArray().map(row=>table.columns.map(column=>{const value=row[column];return value instanceof ArrayBuffer?{blob:Array.from(new Uint8Array(value))}:cell.parse(value);}));
   const normalize=(rows:typeof table.rows)=>rows.map(row=>JSON.stringify(row)).sort();
   if(JSON.stringify(normalize(restored))!==JSON.stringify(normalize(table.rows)))throw new Error('Restored canonical table differs from signed snapshot');
  }
  return {sha256,scope:snapshot.scope,restoredTables:snapshot.tables.length,restoredRows:snapshot.tables.reduce((total,table)=>total+table.rows.length,0),isolated:true as const};
 });
}

async function verifyCanonicalScope(snapshot:OperationalSnapshot){
 const table=snapshot.tables.find(table=>table.name==='project');
 const row=table?.rows.find(row=>row[table.columns.indexOf('id')]===1);
 const doc=row?.[table!.columns.indexOf('doc')];
 if(typeof doc!=='string')throw new Error('Canonical project state is missing');
 const project=z.object({projectId:z.string(),canonicalRepoName:z.string(),acceptedState:z.record(z.string(),z.unknown())}).passthrough().parse(JSON.parse(doc));
 if(project.projectId!==snapshot.scope.repositoryId||project.canonicalRepoName!==snapshot.scope.canonicalRepository||project.acceptedState.currentCommit!==snapshot.scope.head||await operationalHash(project.acceptedState)!==snapshot.scope.acceptedStateHash)throw new Error('Canonical persisted state differs from backup scope');
}

/** Canonical retention catalogue. Holds are persisted before any deletion eligibility is evaluated. */
export class OperationalBackupRetention {
 constructor(private readonly storage:DurableObjectStorage){storage.sql.exec('CREATE TABLE IF NOT EXISTS operational_backup_retention(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL,held INTEGER NOT NULL DEFAULT 0,deleted_at INTEGER)');}
 register(id:string,createdAt:number,authorize:()=>void){z.uuid().parse(id);z.number().int().nonnegative().safe().parse(createdAt);this.storage.transactionSync(()=>{authorize();if(this.storage.sql.exec<{count:number}>('SELECT COUNT(*) AS count FROM operational_backup_retention').toArray()[0]!.count>=1000)throw new Error('Backup retention catalog capacity reached');this.storage.sql.exec('INSERT INTO operational_backup_retention(id,created_at) VALUES(?,?)',id,createdAt);});}
 hold(id:string,held:boolean,authorize:()=>void){this.storage.transactionSync(()=>{authorize();const row=this.storage.sql.exec<{deleted_at:number|null}>('SELECT deleted_at FROM operational_backup_retention WHERE id=?',id).toArray()[0];if(!row||row.deleted_at!==null)throw new Error('Backup is missing or already deleted');this.storage.sql.exec('UPDATE operational_backup_retention SET held=? WHERE id=?',held?1:0,id);});}
 exportAudit(authorize:()=>void){authorize();return this.storage.sql.exec<{id:string;created_at:number;held:number;deleted_at:number|null}>('SELECT id,created_at,held,deleted_at FROM operational_backup_retention ORDER BY created_at,id').toArray();}
 /** Returns candidates only. Actual deletion must recheck the persisted hold synchronously at its storage boundary. */
 eligible(now:number,authorize:()=>void){z.number().int().nonnegative().safe().parse(now);authorize();return this.storage.sql.exec<{id:string}>('SELECT id FROM operational_backup_retention WHERE held=0 AND deleted_at IS NULL AND created_at<=? ORDER BY created_at,id',now-35*24*60*60*1000).toArray().map(row=>row.id);}
 /** Local/operator adapters perform deletion synchronously, so a concurrent hold cannot race the deletion. */
 deleteExpired(id:string,now:number,deleteLocal:()=>void,authorize:()=>void){return this.storage.transactionSync(()=>{authorize();const row=this.storage.sql.exec<{created_at:number;held:number;deleted_at:number|null}>('SELECT created_at,held,deleted_at FROM operational_backup_retention WHERE id=?',id).toArray()[0];if(!row||row.held!==0||row.deleted_at!==null||now<row.created_at+35*24*60*60*1000)throw new Error('Backup retention or hold forbids deletion');deleteLocal();this.storage.sql.exec('UPDATE operational_backup_retention SET deleted_at=? WHERE id=?',now,id);});}
}

export interface EncryptedOperationalBackup {version:1;iv:string;ciphertext:string}
async function encryptionKey(secret:string){await key(secret);return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`flaregit-operational-backup-encryption-v1:${secret}`)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
/** Encryption is independent of the storage provider; signatures remain checked during restoration. */
export async function encryptOperationalBackup(backup:SignedOperationalBackup,secret:string):Promise<EncryptedOperationalBackup>{
 bounded(snapshotSchema.parse(backup.snapshot));const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('flaregit-operational-backup-v1')},await encryptionKey(secret),new TextEncoder().encode(JSON.stringify(backup)));
 return {version:1,iv:encodeBase64(iv),ciphertext:encodeBase64(new Uint8Array(ciphertext))};
}
export async function decryptOperationalBackup(envelope:EncryptedOperationalBackup,secret:string):Promise<SignedOperationalBackup>{
 if(envelope.version!==1||envelope.iv.length!==16||envelope.ciphertext.length>Math.ceil((MAX_BYTES+1024)/3)*4||envelope.ciphertext.length%4!==0||/[^A-Za-z0-9+/=]/.test(envelope.ciphertext))throw new Error('Invalid encrypted backup envelope');
 const iv=decodeBase64(envelope.iv);if(iv.length!==12)throw new Error('Invalid encrypted backup IV');
 const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('flaregit-operational-backup-v1')},await encryptionKey(secret),decodeBase64(envelope.ciphertext));
 const backup=z.object({snapshot:snapshotSchema,sha256:z.string().regex(/^[a-f0-9]{64}$/),signature:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(JSON.parse(new TextDecoder().decode(plaintext)));bounded(backup.snapshot);return backup;
}

function encodeBase64(bytes:Uint8Array){const chunks:string[]=[];for(let offset=0;offset<bytes.length;offset+=8192)chunks.push(String.fromCharCode(...bytes.subarray(offset,offset+8192)));return btoa(chunks.join(''));}
function decodeBase64(text:string){return Uint8Array.from(atob(text),character=>character.charCodeAt(0));}
