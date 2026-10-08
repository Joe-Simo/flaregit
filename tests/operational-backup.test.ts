import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {captureOperationalBackup,restoreOperationalBackup,operationalHash} from '../src/server/operational-backup';
function database(){const db=new Database(':memory:');const storage={sql:{exec(query:string,...bindings:unknown[]){const rows=db.query(query).all(...bindings as Array<string|number|null|Uint8Array>);return {toArray:()=>rows};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}};return {db,storage:storage as unknown as DurableObjectStorage};}
const secret='isolated-operator-key-at-least-32-bytes';
test('signed canonical recovery preserves accepted authority, history and Git scope in an isolated database',async()=>{
 const source=database(),target=database();
 source.db.exec('CREATE TABLE project(id INTEGER PRIMARY KEY,doc TEXT NOT NULL);CREATE TABLE audit(id INTEGER PRIMARY KEY,doc TEXT NOT NULL);CREATE UNIQUE INDEX audit_doc ON audit(doc);CREATE TABLE operational_backups(id TEXT PRIMARY KEY,envelope TEXT)');
 const accepted={currentCommit:'a'.repeat(40),history:[{accepted:'candidate-one',reviewer:'owner'}]};
 source.db.query('INSERT INTO project VALUES(1,?)').run(JSON.stringify({projectId:'repository',canonicalRepoName:'owner/repository',acceptedState:accepted}));source.db.query('INSERT INTO audit VALUES(1,?)').run('accepted candidate-one');
 const scope={repositoryId:'repository',canonicalRepository:'owner/repository',head:accepted.currentCommit,acceptedStateHash:await operationalHash(accepted)};
 source.db.query('INSERT INTO operational_backups VALUES(?,?)').run('older','encrypted-payload');
 let authorized=0;const backup=await captureOperationalBackup(source.storage,scope,secret,()=>{authorized++;});
 const {encryptOperationalBackup,decryptOperationalBackup}=await import('../src/server/operational-backup');const encrypted=await encryptOperationalBackup(backup,secret);expect(typeof encrypted.ciphertext).toBe('string');expect(backup.snapshot.tables.some(table=>table.name.startsWith('operational_'))).toBe(false);expect(await decryptOperationalBackup(encrypted,secret)).toEqual(backup);await expect(decryptOperationalBackup(encrypted,'another-encryption-secret-at-least-32-bytes')).rejects.toThrow();
 const receipt=await restoreOperationalBackup(target.storage,backup,secret,scope,async()=>true,()=>{authorized++;});
 expect(receipt.restoredRows).toBe(2);expect(authorized).toBe(3);expect(target.db.query('SELECT * FROM project').all()).toEqual(source.db.query('SELECT * FROM project').all());
 expect(()=>target.db.query('INSERT INTO audit VALUES(2,?)').run('accepted candidate-one')).toThrow();
 await expect(restoreOperationalBackup(target.storage,backup,secret,scope,async()=>true,()=>{})).rejects.toThrow('isolated');
 source.db.close();target.db.close();
});
test('tampered or customer signatures and unverified native clones cannot activate authority',async()=>{
 const source=database();source.db.exec('CREATE TABLE project(id INTEGER PRIMARY KEY,doc TEXT)');const accepted={currentCommit:'a'.repeat(40),history:[]};source.db.query('INSERT INTO project VALUES(1,?)').run(JSON.stringify({projectId:'repository',canonicalRepoName:'owner/repository',acceptedState:accepted}));
 const scope={repositoryId:'repository',canonicalRepository:'owner/repository',head:'a'.repeat(40),acceptedStateHash:await operationalHash(accepted)};
 const backup=await captureOperationalBackup(source.storage,scope,secret,()=>{}),target=database();
 await expect(restoreOperationalBackup(target.storage,backup,'another-operator-key-at-least-32-bytes',scope,async()=>true,()=>{})).rejects.toThrow('operator');
 await expect(restoreOperationalBackup(target.storage,backup,secret,scope,async()=>false,()=>{})).rejects.toThrow('Git');
 backup.snapshot.tables[0]!.rows[0]![1]='forged';
 await expect(restoreOperationalBackup(target.storage,backup,secret,scope,async()=>true,()=>{})).rejects.toThrow('digest');
 expect(target.db.query("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);source.db.close();target.db.close();
});
test('persisted holds prevent retention deletion even after eligibility was read',async()=>{
 const {OperationalBackupRetention}=await import('../src/server/operational-backup');const target=database(),retention=new OperationalBackupRetention(target.storage),id=crypto.randomUUID(),now=36*24*60*60*1000;let deleted=false;
 retention.register(id,0,()=>{});expect(retention.eligible(now,()=>{})).toEqual([id]);retention.hold(id,true,()=>{});
 expect(()=>retention.deleteExpired(id,now,()=>{deleted=true;},()=>{})).toThrow('hold');expect(deleted).toBe(false);
 retention.hold(id,false,()=>{});retention.deleteExpired(id,now,()=>{deleted=true;},()=>{});expect(deleted).toBe(true);expect(retention.eligible(now,()=>{})).toEqual([]);expect(retention.exportAudit(()=>{})[0]?.deleted_at).toBe(now);target.db.close();
});
