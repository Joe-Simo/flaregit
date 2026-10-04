import {Database} from 'bun:sqlite';
import {expect,test} from 'bun:test';
import {AgentCredentialIncidents,type AgentCredentialScope} from '../src/server/agent-credential-incidents';
const now=1000;
const context=():AgentCredentialScope=>({attemptId:crypto.randomUUID(),nativeId:crypto.randomUUID(),runId:'run',workflowId:'workflow',taskId:'task',projectId:'p123456789abc',incarnation:crypto.randomUUID(),actorId:'owner',accountKey:'account',phase:'apply',snapshotDigest:'a'.repeat(64),generation:0,repoName:'workspace',scope:'write'});
function fixture(){const db=new Database(':memory:');const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows,one:()=>rows[0]};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}};return{db,ledger:new AgentCredentialIncidents(storage as unknown as DurableObjectStorage)};}
test('durable issuance intent remains unknown after lost ACK and cannot change exact run scope',async()=>{
 const {db,ledger}=fixture(),id=crypto.randomUUID(),scope=context();
 expect(()=>ledger.begin(id,scope,2000,()=>{throw Error('Withdrawn');},now)).toThrow('Withdrawn');expect(ledger.summary(id)).toBeNull();
 expect(ledger.begin(id,scope,2000,()=>{},now)).toBe(true);expect(ledger.begin(id,scope,2000,()=>{},now)).toBe(false);
 expect(()=>ledger.begin(id,{...scope,nativeId:crypto.randomUUID()},2000,()=>{},now)).toThrow('changed');
 expect(ledger.pendingBatch(3000)).toEqual([]);expect(ledger.summary(id)?.status).toBe('issuance_unknown');
 // A delayed secret receipt still grants cleanup authority after caller authority was withdrawn.
 await ledger.record(id,scope,'synthetic-agent-secret',5000,3000);
 await expect(ledger.record(id,{...scope,repoName:'other'},'synthetic-agent-secret',5000,3000)).rejects.toThrow('exact issuance');
 expect(JSON.stringify(ledger.summary(id))).not.toContain('synthetic-agent-secret');
 expect(ledger.credentialForRevocation(id,3000)?.context).toEqual(scope);
 expect(ledger.markAttempt(id)).toBe(true);await expect(ledger.markRevoked(id,'other')).rejects.toThrow('mismatch');
 await ledger.markRevoked(id,'synthetic-agent-secret');expect(db.query('SELECT token FROM agent_credential_incidents').get()).toEqual({token:null});
 await ledger.record(id,scope,'synthetic-agent-secret',5000,3000);expect(ledger.summary(id)?.status).toBe('revoked');expect(ledger.pendingBatch(3000)).toEqual([]);
});
test('bounded funded sweeps preserve unknown expiry and separate expiry from revocation',async()=>{
 const {db,ledger}=fixture(),id=crypto.randomUUID(),scope=context();ledger.begin(id,scope,2000,()=>{},now);await ledger.record(id,scope,'synthetic',2500,now);
 for(let i=0;i<4;i++)expect(ledger.markAutomaticSweep(id)).toBe(true);expect(ledger.markAutomaticSweep(id)).toBe(false);
 expect(ledger.pendingBatch(now)).toEqual([]);expect(ledger.credentialForRevocation(id,now)?.token).toBe('synthetic');
 for(let i=0;i<4;i++)expect(ledger.markAttempt(id)).toBe(true);expect(ledger.markAttempt(id)).toBe(false);expect(ledger.nextAlarm(now)).toBe(2500);
 ledger.pendingBatch(2500);expect(ledger.summary(id)?.status).toBe('expired_unverified');expect(db.query('SELECT token FROM agent_credential_incidents').get()).toEqual({token:null});await expect(ledger.markRevoked(id,'synthetic')).rejects.toThrow('unverified');
 const unknown=crypto.randomUUID();ledger.begin(unknown,context(),2000,()=>{},now);const saved=context(),other=crypto.randomUUID();ledger.begin(other,saved,2000,()=>{},now);await ledger.record(other,saved,'unknown-expiry',NaN,now);expect(ledger.summary(other)?.expiresAt).toBeNull();expect(ledger.pendingBatch(999999999)[0]?.id).toBe(other);expect(ledger.summary(unknown)?.status).toBe('issuance_unknown');
});
test('bounded batches and input validation do not expose or replace credentials',async()=>{
 const {ledger}=fixture();for(let i=0;i<21;i++){const id=crypto.randomUUID(),scope=context();ledger.begin(id,scope,2000,()=>{},now);await ledger.record(id,scope,'synthetic',2500,now);}expect(ledger.pendingBatch(now)).toHaveLength(20);
 expect(()=>ledger.begin(crypto.randomUUID(),context(),901001,()=>{},now)).toThrow('lifetime');
 const id=crypto.randomUUID(),scope=context();ledger.begin(id,scope,2000,()=>{},now);await expect(ledger.record(id,scope,'bad\nsecret',2500,now)).rejects.toThrow('Invalid');expect(ledger.summary(id)?.status).toBe('issuance_unknown');
});
