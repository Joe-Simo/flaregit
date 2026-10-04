import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { InitialForkCredentials, type InitialForkCredentialScope } from '../src/server/initial-fork-credentials';
function fixture() { const db = new Database(':memory:'), storage = { sql: { exec(query: string, ...bindings: Array<string | number>) { const rows = db.query(query).all(...bindings); return { toArray: () => rows }; } }, transactionSync<T>(fn: () => T) { return db.transaction(fn)(); } } as unknown as DurableObjectStorage; return { db, ledger: new InitialForkCredentials(storage) }; }
function scope(): InitialForkCredentialScope { return { eventId: crypto.randomUUID(), allocationId: crypto.randomUUID(), taskId: 'task', projectId: 'project', incarnation: crypto.randomUUID(), canonicalRepoName: 'canonical', workspaceRepoName: 'workspace', actorId: 'Original_Actor', accountKey: 'account' }; }
test('initial credential holds before fork; late response survives actor withdrawal and settles only exact positive revocation', async () => {
  const f = fixture(), intent = scope(); let active = true;
  try {
    expect(f.ledger.begin(intent, () => { if (!active) throw Error('Withdrawn'); })).toBe(true);
    expect(f.ledger.begin(intent, () => {})).toBe(false); expect(f.ledger.settled(intent)).toBe(false);
    active = false; await f.ledger.record(intent, 'synthetic-initial-fork-token');
    expect(f.ledger.credentialForRevocation(intent.eventId)?.scope).toEqual(intent);
    expect(await f.ledger.markRevoked(intent, 'synthetic-initial-fork-token', { repoName: 'foreign-workspace', revoked: true })).toBe(false);
    expect(await f.ledger.markRevoked(intent, 'synthetic-initial-fork-token', { repoName: intent.workspaceRepoName, revoked: false })).toBe(false);
    expect(f.ledger.settled(intent)).toBe(false);
    expect(await f.ledger.markRevoked(intent, 'synthetic-initial-fork-token', { repoName: intent.workspaceRepoName, revoked: true })).toBe(true);
    await f.ledger.record(intent, 'synthetic-initial-fork-token');
    expect(f.ledger.settled(intent)).toBe(true); expect(f.ledger.credentialForRevocation(intent.eventId)).toBeNull();
    expect(JSON.stringify(f.ledger.summary(intent.eventId))).not.toContain('synthetic-initial-fork-token');
    expect(f.db.query('SELECT token FROM initial_fork_credentials').get()).toEqual({ token: null });
  } finally { f.db.close(); }
});
test('same event cannot change allocation, tenant or secret; malformed or missing ACK never acquires cleanup proof', async () => {
  const f = fixture(), intent = scope();
  try {
    f.ledger.begin(intent, () => {});
    for (const change of [{ allocationId: crypto.randomUUID() }, { workspaceRepoName: 'other' }, { actorId: 'original_actor' }, { incarnation: crypto.randomUUID() }]) expect(() => f.ledger.begin({ ...intent, ...change }, () => {})).toThrow('intent changed');
    await expect(f.ledger.record({ ...intent, workspaceRepoName: 'other' }, 'synthetic-token')).rejects.toThrow('intent');
    await expect(f.ledger.record(intent, 'malformed\nvalue')).rejects.toThrow('receipt');
    expect(f.ledger.summary(intent.eventId)).toMatchObject({ status: 'issuance_unknown', providerScope: 'unverified', expiresAt: null });
    expect(f.ledger.settled(intent)).toBe(false); expect(f.ledger.pendingBatch()).toEqual([]);
    await f.ledger.record(intent, 'synthetic-token'); await expect(f.ledger.record(intent, 'different-token')).rejects.toThrow('changed');
    await expect(f.ledger.markRevoked(intent, 'different-token', { repoName: intent.workspaceRepoName, revoked: true })).rejects.toThrow('scope');
  } finally { f.db.close(); }
});
test('automatic cleanup is bounded without clearing unknown credentials; funded owner retry remains possible', async () => {
  const f = fixture(), intent = scope();
  try {
    f.ledger.begin(intent, () => {}); await f.ledger.record(intent, 'synthetic-token');
    for (let index = 0; index < 4; index++) { expect(f.ledger.markAutomaticSweep(intent.eventId)).toBe(true); expect(f.ledger.markAttempt(intent.eventId)).toBe(true); }
    expect(f.ledger.markAutomaticSweep(intent.eventId)).toBe(false); expect(f.ledger.pendingBatch()).toEqual([]); expect(f.ledger.nextWake()).toBeNull(); expect(f.ledger.settled(intent)).toBe(false);
    expect(f.ledger.markAttempt(intent.eventId)).toBe(true);
    expect(await f.ledger.markRevoked(intent, 'synthetic-token', { repoName: intent.workspaceRepoName, revoked: true })).toBe(true);
    expect(f.ledger.settled(intent)).toBe(true);
  } finally { f.db.close(); }
});
test('pre-dispatch authority rejection rolls back all initial credential intent state', () => { const f = fixture(); try { expect(() => f.ledger.begin(scope(), () => { throw Error('No authority'); })).toThrow('No authority'); expect(f.db.query('SELECT COUNT(*) AS n FROM initial_fork_credentials').get()).toEqual({ n: 0 }); } finally { f.db.close(); } });

test('faulting digest cannot lose a returned secret or a positive revocation after actor withdrawal', async () => {
  const f = fixture(), intent = scope(), originalDigest = crypto.subtle.digest;
  let active = true;
  try {
    f.ledger.begin(intent, () => { if (!active) throw Error('Withdrawn'); }); active = false;
    crypto.subtle.digest = async () => { throw Error('Synthetic digest interruption'); };
    const recording = f.ledger.record(intent, 'synthetic-fault-receipt');
    // Check before awaiting: durable cleanup input must predate fingerprint work.
    expect(f.ledger.credentialForRevocation(intent.eventId)?.token).toBe('synthetic-fault-receipt');
    await expect(recording).rejects.toThrow('digest interruption');
    expect(f.ledger.summary(intent.eventId)?.status).toBe('pending');
    expect(f.ledger.settled(intent)).toBe(false);
    await expect(f.ledger.record({ ...intent, allocationId: crypto.randomUUID() }, 'different-token')).rejects.toThrow('intent');
    await expect(f.ledger.record(intent, 'different-token')).rejects.toThrow('changed');
    expect(f.ledger.credentialForRevocation(intent.eventId)?.token).toBe('synthetic-fault-receipt');
    await expect(f.ledger.markRevoked(intent, 'synthetic-fault-receipt', { repoName: intent.workspaceRepoName, revoked: true })).rejects.toThrow('digest interruption');
    expect(f.ledger.settled(intent)).toBe(true); // Positive SDK proof survived enrichment failure.
    expect(f.ledger.credentialForRevocation(intent.eventId)).toBeNull();
    crypto.subtle.digest = originalDigest;
    await f.ledger.record(intent, 'synthetic-fault-receipt');
    expect(f.ledger.summary(intent.eventId)?.status).toBe('revoked');
    expect(f.db.query('SELECT token FROM initial_fork_credentials').get()).toEqual({ token: null });
    await expect(f.ledger.record(intent, 'different-token')).rejects.toThrow('changed');
    expect(f.ledger.settled(intent)).toBe(true);
  } finally { crypto.subtle.digest = originalDigest; f.db.close(); }
});
test('generic extraction reads and settles an existing fork row without changing legacy payload bytes', async () => {
  const f = fixture(), intent = scope(), { initialForkCredentialScopeSchema } = await import('../src/server/initial-fork-credentials');
  const payload = JSON.stringify(initialForkCredentialScopeSchema.parse(intent));
  const token = 'synthetic-legacy-fork', hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join('');
  try {
    f.db.query("INSERT INTO initial_fork_credentials VALUES(?,?,'pending',?,?,2,1)").run(intent.eventId, payload, token, hash);
    expect(f.ledger.begin(intent, () => {})).toBe(false); expect(f.ledger.credentialForRevocation(intent.eventId)?.token).toBe(token);
    expect(await f.ledger.markRevoked(intent, token, { repoName: intent.workspaceRepoName, revoked: true })).toBe(true);
    expect(f.db.query('SELECT payload,status,token,attempts,automatic_sweeps FROM initial_fork_credentials').get()).toEqual({ payload, status: 'revoked', token: null, attempts: 2, automatic_sweeps: 1 });
  } finally { f.db.close(); }
});
