import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { RepositoryInitializationIntents, type RepositoryInitializationScope, type ReadmeRepositoryInitializationScope, type RepositoryEmptyProof } from '../src/server/repository-initialization-intents';
function fixture() { const db = new Database(':memory:'), storage = { sql: { exec(query: string, ...bindings: Array<string | number>) { const rows = db.query(query).all(...bindings); return { toArray: () => rows }; } }, transactionSync<T>(fn: () => T) { return db.transaction(fn)(); } } as unknown as DurableObjectStorage; return { db, ledger: new RepositoryInitializationIntents(storage) }; }
function scope(): ReadmeRepositoryInitializationScope { return { requestId: crypto.randomUUID(), eventId: crypto.randomUUID(), allocationId: crypto.randomUUID(), projectId: 'project', incarnation: crypto.randomUUID(), canonicalRepoName: 'canonical', accountKey: 'account', actorId: 'Original_Actor', name: 'Example', description: 'Requested README', defaultBranch: 'release', readme: '# Example\n\nRequested README\n', authorName: 'Original author', authorEmail: 'account@users.noreply.flaregit.com', commitTimestamp: '2026-10-04T00:00:00.000Z' }; }
const metadata = { id: 'provider-id', name: 'canonical', remote: 'https://provider.example/canonical.git' };
test('initialization becomes ready only after real-shaped commit and exact positive credential/native receipts', async () => {
  const f = fixture(), intent = scope();
  try {
    const prepared = f.ledger.prepare(intent, () => {}); expect(f.ledger.beginCreate(intent.eventId, () => {})).toBe(true); expect(f.ledger.beginCreate(intent.eventId, () => {})).toBe(false);
    expect(() => f.ledger.complete(intent.eventId, () => {})).toThrow('unconfirmed');
    await f.ledger.recordCreated(intent.eventId, metadata, 'synthetic-canonical-token');
    const nativeName = `readme-${intent.eventId}`; expect(f.ledger.beginNative(intent.eventId, nativeName, () => {})).toBe(true); expect(f.ledger.beginNative(intent.eventId, nativeName, () => {})).toBe(false);
    const commit = { head: 'a'.repeat(40), tree: 'b'.repeat(40), defaultBranch: 'release' };
    f.ledger.recordCommit(intent.eventId, commit);
    expect(f.ledger.get(intent.eventId)?.phase).toBe('publication_prepared');
    expect(f.ledger.beginPush(intent.eventId, () => {})).toBe(true);
    expect(f.ledger.beginPush(intent.eventId, () => {})).toBe(false);
    f.ledger.confirmPublished(intent.eventId, commit);
    expect(() => f.ledger.complete(intent.eventId, () => {})).toThrow('unconfirmed');
    expect(f.ledger.confirmNativeStopped(intent.eventId, { name: nativeName, stopped: true, sealed: false })).toBe(false);
    expect(f.ledger.confirmNativeStopped(intent.eventId, { name: nativeName, stopped: true, sealed: true })).toBe(true);
    expect(await f.ledger.confirmCredentialRevoked(intent.eventId, 'synthetic-canonical-token', { repoName: 'foreign', revoked: true })).toBe(false);
    expect(await f.ledger.confirmCredentialRevoked(intent.eventId, 'synthetic-canonical-token', { repoName: 'canonical', revoked: true })).toBe(true);
    const ready = f.ledger.complete(intent.eventId, () => {}); expect(ready.phase).toBe('ready'); expect(ready.scope).toEqual(prepared.scope); expect(f.ledger.complete(intent.eventId, () => {})).toEqual(ready);
    expect(JSON.stringify(ready)).not.toContain('synthetic-canonical-token');
    expect(() => f.ledger.prepare({ ...intent, defaultBranch: 'main' }, () => {})).toThrow('identity');
  } finally { f.db.close(); }
});
test('lost SDK response stays held, original retries never repeat create or adopt a name', () => {
  const f = fixture(), intent = scope();
  try { f.ledger.prepare(intent, () => {}); f.ledger.beginCreate(intent.eventId, () => {}); expect(f.ledger.prepare(intent, () => {}).phase).toBe('create_possible'); expect(f.ledger.beginCreate(intent.eventId, () => {})).toBe(false); expect(() => f.ledger.beginNative(intent.eventId, `readme-${intent.eventId}`, () => {})).toThrow('recorded'); expect(() => f.ledger.complete(intent.eventId, () => {})).toThrow('unconfirmed'); expect(f.ledger.credentials.summary(intent.eventId)?.status).toBe('issuance_unknown'); } finally { f.db.close(); }
});
test('late malformed SDK metadata still retains returned credential after authority withdrawal', async () => {
  const f = fixture(), intent = scope(); let active = true;
  try { f.ledger.prepare(intent, () => {}); f.ledger.beginCreate(intent.eventId, () => {}); active = false; await expect(f.ledger.recordCreated(intent.eventId, { ...metadata, name: 'different-repo' }, 'synthetic-late-token')).rejects.toThrow('intent'); expect(f.ledger.credentials.credentialForRevocation(intent.eventId)?.token).toBe('synthetic-late-token'); expect(f.ledger.get(intent.eventId)?.phase).toBe('create_possible'); expect(() => f.ledger.complete(intent.eventId, () => { if (!active) throw Error('Withdrawn'); })).toThrow('Withdrawn'); } finally { f.db.close(); }
});
test('prepared authority rejection rolls back credential and provider dispatch state', () => {
  const f = fixture(), intent = scope(); try { f.ledger.prepare(intent, () => {}); expect(() => f.ledger.beginCreate(intent.eventId, () => { throw Error('Withdrawn'); })).toThrow('Withdrawn'); expect(f.ledger.get(intent.eventId)?.phase).toBe('prepared'); expect(f.ledger.credentials.summary(intent.eventId)).toBeNull(); expect(() => f.ledger.prepare({ ...scope(), readme: 'Unrequested bytes' }, () => {})).toThrow('content'); } finally { f.db.close(); }
});
test('canonical SDK token is durable before failing enrichment and late facts never authorize use', async () => {
  const f = fixture(), intent = scope(), originalDigest = crypto.subtle.digest;
  try {
    f.ledger.prepare(intent, () => {}); f.ledger.beginCreate(intent.eventId, () => {});
    crypto.subtle.digest = async () => { throw Error('Synthetic canonical digest interruption'); };
    const response = f.ledger.recordCreated(intent.eventId, metadata, 'synthetic-canonical-late');
    expect(f.ledger.credentials.credentialForRevocation(intent.eventId)?.token).toBe('synthetic-canonical-late');
    await expect(response).rejects.toThrow('digest interruption');
    expect(f.ledger.get(intent.eventId)?.phase).toBe('created');
    expect(f.ledger.beginCreate(intent.eventId, () => {})).toBe(false);
    expect(() => f.ledger.complete(intent.eventId, () => { throw Error('Actor withdrawn'); })).toThrow('Actor withdrawn');
    crypto.subtle.digest = originalDigest;
    await f.ledger.recordCreated(intent.eventId, metadata, 'synthetic-canonical-late');
    expect(await f.ledger.confirmCredentialRevoked(intent.eventId, 'synthetic-canonical-late', { repoName: 'canonical', revoked: true })).toBe(true);
    expect(JSON.stringify(f.ledger.get(intent.eventId))).not.toContain('synthetic-canonical-late');
  } finally { crypto.subtle.digest = originalDigest; f.db.close(); }
});

test('client request UUIDs are actor-local while native server events remain distinct and replay never changes allocation', () => {
  const f = fixture(), first = scope(); try { const saved = f.ledger.prepare(first, () => {}); const other = { ...scope(), requestId: first.requestId, actorId: 'Another_Actor', projectId: 'other-project', canonicalRepoName: 'other-canonical' }; const second = f.ledger.prepare(other, () => {}); expect(second.scope.eventId).not.toBe(saved.scope.eventId); expect(f.ledger.getByRequest(first.requestId, first.actorId)).toEqual(saved); expect(f.ledger.getByRequest(first.requestId, other.actorId)).toEqual(second); expect(() => f.ledger.prepare({ ...first, eventId: crypto.randomUUID() }, () => {})).toThrow('original server event'); } finally { f.db.close(); }
});

test('lost push acknowledgement preserves original author/time/SHA and requires separate exact readback without another push', async () => {
  const f = fixture(), intent = scope(), commit = { head: 'a'.repeat(40), tree: 'b'.repeat(40), defaultBranch: 'release' }; try {
    f.ledger.prepare(intent, () => {}); f.ledger.beginCreate(intent.eventId, () => {}); await f.ledger.recordCreated(intent.eventId, metadata, 'synthetic-publication-token');
    f.ledger.beginNative(intent.eventId, `readme-${intent.eventId}`, () => {}); f.ledger.recordCommit(intent.eventId, commit); f.ledger.beginPush(intent.eventId, () => {});
    f.ledger.confirmNativeStopped(intent.eventId, { name: `readme-${intent.eventId}`, stopped: true, sealed: true }); await f.ledger.confirmCredentialRevoked(intent.eventId, 'synthetic-publication-token', { repoName: 'canonical', revoked: true });
    expect(() => f.ledger.complete(intent.eventId, () => {})).toThrow('unconfirmed');
    expect(f.ledger.prepare(intent, () => {}).scope.commitTimestamp).toBe(intent.commitTimestamp);
    expect(() => f.ledger.prepare({ ...intent, commitTimestamp: '2026-10-05T00:00:00.000Z' }, () => {})).toThrow('identity');
    expect(() => f.ledger.recordCommit(intent.eventId, { ...commit, head: 'c'.repeat(40) })).toThrow('intent');
    expect(() => f.ledger.confirmPublished(intent.eventId, { ...commit, defaultBranch: 'main' })).toThrow('original');
    expect(() => f.ledger.beginPush(intent.eventId, () => {})).toThrow('active');
    f.ledger.confirmPublished(intent.eventId, commit); expect(f.ledger.complete(intent.eventId, () => {}).phase).toBe('ready');
    expect(f.ledger.get(intent.eventId)?.commit).toEqual(commit);
  } finally { f.db.close(); }
});

function emptyScope():RepositoryInitializationScope{return {...scope(),initialization:'empty',readme:null,authorName:null,authorEmail:null,commitTimestamp:null};}
test('empty initialization records authoritative absence and cleanup without inventing initial history',async()=>{
 const f=fixture(),intent=emptyScope();try{
  const prepared=f.ledger.prepare(intent,()=>{});expect(prepared.scope.initialization).toBe('empty');
  expect(f.ledger.beginCreate(intent.eventId,()=>{})).toBe(true);
  await f.ledger.recordCreated(intent.eventId,{...metadata,defaultBranch:'release'},'synthetic-empty-token');
  expect(await f.ledger.confirmCredentialRevoked(intent.eventId,'synthetic-empty-token',{repoName:'canonical',revoked:true})).toBe(true);
  expect(f.ledger.beginNative(intent.eventId,`empty-${intent.eventId}`,()=>{})).toBe(true);
  expect(f.ledger.beginReadCredential(intent.eventId,()=>{})).toBe(true);await f.ledger.recordReadCredential(intent.eventId,'synthetic-empty-read-token');
  const proof:RepositoryEmptyProof={repositoryId:metadata.id,canonicalRepoName:'canonical',defaultRef:'refs/heads/release',refs:[],symbolicHead:null};
  expect(()=>f.ledger.complete(intent.eventId,()=>{})).toThrow('unconfirmed');
  expect(()=>f.ledger.recordEmpty(intent.eventId,{...proof,repositoryId:'other'})).toThrow('scope');
  expect(()=>f.ledger.recordEmpty(intent.eventId,{...proof,symbolicHead:'refs/heads/main'})).toThrow('scope');
  f.ledger.recordEmpty(intent.eventId,proof);expect(f.ledger.get(intent.eventId)?.phase).toBe('empty_verified');
  expect(()=>f.ledger.recordCommit(intent.eventId,{head:'a'.repeat(40),tree:'b'.repeat(40),defaultBranch:'release'})).toThrow('native intent');
  expect(()=>f.ledger.beginPush(intent.eventId,()=>{})).toThrow('initial Git publication');
  expect(()=>f.ledger.complete(intent.eventId,()=>{})).toThrow('unconfirmed');
  expect(f.ledger.confirmNativeStopped(intent.eventId,{name:`empty-${intent.eventId}`,stopped:true,sealed:true})).toBe(true);
  expect(()=>f.ledger.complete(intent.eventId,()=>{})).toThrow('unconfirmed');
  expect(await f.ledger.confirmReadCredentialRevoked(intent.eventId,'synthetic-empty-read-token',{repoName:'wrong',revoked:true})).toBe(false);
  expect(()=>f.ledger.complete(intent.eventId,()=>{})).toThrow('unconfirmed');
  expect(await f.ledger.confirmReadCredentialRevoked(intent.eventId,'synthetic-empty-read-token',{repoName:'canonical',revoked:true})).toBe(true);
  const ready=f.ledger.complete(intent.eventId,()=>{});expect(ready.phase).toBe('ready');expect(ready.emptyProof).toEqual(proof);expect(ready.commit).toBeUndefined();expect(ready.published).toBeUndefined();
  expect(f.ledger.complete(intent.eventId,()=>{})).toEqual(ready);expect(f.ledger.getByRequest(intent.requestId,intent.actorId)?.scope).toEqual(intent);
  expect(()=>f.ledger.prepare({...intent,defaultBranch:'main'},()=>{})).toThrow('identity');
 }finally{f.db.close();}
});
test('unadvertised empty HEAD requires the actual matching SDK default branch receipt',async()=>{
 const f=fixture(),intent=emptyScope();try{
  f.ledger.prepare(intent,()=>{});f.ledger.beginCreate(intent.eventId,()=>{});await f.ledger.recordCreated(intent.eventId,metadata,'synthetic-empty-token');await f.ledger.confirmCredentialRevoked(intent.eventId,'synthetic-empty-token',{repoName:'canonical',revoked:true});f.ledger.beginNative(intent.eventId,`empty-${intent.eventId}`,()=>{});f.ledger.beginReadCredential(intent.eventId,()=>{});await f.ledger.recordReadCredential(intent.eventId,'synthetic-empty-read-token');
  const proof:RepositoryEmptyProof={repositoryId:metadata.id,canonicalRepoName:'canonical',defaultRef:'refs/heads/release',refs:[],symbolicHead:null};
  expect(()=>f.ledger.recordEmpty(intent.eventId,proof)).toThrow('HEAD proof');
  f.ledger.recordEmpty(intent.eventId,{...proof,symbolicHead:'refs/heads/release'});
  expect(f.ledger.get(intent.eventId)?.emptyProof?.symbolicHead).toBe('refs/heads/release');
  expect(()=>f.ledger.recordEmpty(intent.eventId,{...proof,symbolicHead:'refs/heads/main'})).toThrow('scope');
 }finally{f.db.close();}
});

test('lost empty READ issuance stays held rather than minting twice or inferring cleanup',async()=>{
 const f=fixture(),intent=emptyScope();try{
  f.ledger.prepare(intent,()=>{});f.ledger.beginCreate(intent.eventId,()=>{});await f.ledger.recordCreated(intent.eventId,{...metadata,defaultBranch:'release'},'synthetic-empty-token');await f.ledger.confirmCredentialRevoked(intent.eventId,'synthetic-empty-token',{repoName:'canonical',revoked:true});f.ledger.beginNative(intent.eventId,`empty-${intent.eventId}`,()=>{});
  expect(f.ledger.beginReadCredential(intent.eventId,()=>{})).toBe(true);expect(f.ledger.beginReadCredential(intent.eventId,()=>{})).toBe(false);
  expect(f.ledger.readCredentials.summary(intent.eventId)?.status).toBe('issuance_unknown');
  expect(()=>f.ledger.recordEmpty(intent.eventId,{repositoryId:metadata.id,canonicalRepoName:'canonical',defaultRef:'refs/heads/release',refs:[],symbolicHead:null})).toThrow('Active empty');
  f.ledger.confirmNativeStopped(intent.eventId,{name:`empty-${intent.eventId}`,stopped:true,sealed:true});expect(()=>f.ledger.complete(intent.eventId,()=>{})).toThrow('unconfirmed');expect(f.ledger.get(intent.eventId)?.phase).toBe('native_possible');
 }finally{f.db.close();}
});
