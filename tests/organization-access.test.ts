import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { OrganizationAccessLedger } from '../src/server/organization-access';
function fixture() {
  const db = new Database(':memory:');
  const storage = { sql: { exec(query: string, ...bindings: Array<string | number>) { const rows = db.query(query).all(...bindings); return { toArray: () => rows }; } }, transactionSync<T>(fn: () => T) { return db.transaction(fn)(); } } as unknown as DurableObjectStorage;
  return { db, storage, ledger: new OrganizationAccessLedger(storage) };
}
test('typed teams cannot collide with users; revocation removes inheritance across repositories and restart', () => {
  const f = fixture(); try {
    f.ledger.createOrganization('org', 'Organization', 'owner');
    f.ledger.setMember('org', 'owner', 1, 'member', 'member');
    f.ledger.createTeam('org', 'owner', 2, 'outside', 'Engineering');
    f.ledger.setTeamMember('org', 'owner', 3, 'outside', 'member', true);
    f.ledger.grantRepository('org', 'owner', 4, 'repo-a', { kind: 'team', id: 'outside' }, 'write');
    f.ledger.grantRepository('org', 'owner', 5, 'repo-b', { kind: 'team', id: 'outside' }, 'read');
    f.ledger.grantRepository('org', 'owner', 6, 'repo-a', { kind: 'user', id: 'outside' }, 'read');
    const restarted = new OrganizationAccessLedger(f.storage);
    expect(restarted.resolveAccess('org', 'repo-a', 'outside')?.role).toBe('read');
    expect(restarted.resolveAccess('org', 'repo-b', 'outside')?.role).toBeNull();
    expect(restarted.resolveAccess('org', 'repo-a', 'member')?.role).toBe('write');
    restarted.removeMember('org', 'owner', 7, 'member');
    expect(restarted.resolveAccess('org', 'repo-a', 'member')?.role).toBeNull();
    expect(restarted.resolveAccess('org', 'repo-b', 'member')?.role).toBeNull();
    expect(restarted.revision('org', 7)?.teams[0]?.members).toEqual(['member']);
    expect(restarted.snapshot('org')?.teams[0]?.members).toEqual([]);
  } finally { f.db.close(); }
});
test('last owner, stale revision, malformed subject and revoked actor fail atomically', () => {
  const f = fixture(); try {
    f.ledger.createOrganization('org', 'Org', 'owner');
    expect(() => f.ledger.removeMember('org', 'owner', 1, 'owner')).toThrow('owner');
    expect(() => f.ledger.setMember('org', 'owner', 1, 'owner', 'member')).toThrow('owner');
    expect(f.ledger.snapshot('org')?.revision).toBe(1);
    f.ledger.setMember('org', 'owner', 1, 'other', 'owner');
    expect(() => f.ledger.createTeam('org', 'owner', 1, 'team', 'Team')).toThrow('revision');
    f.ledger.removeMember('org', 'other', 2, 'owner');
    expect(() => f.ledger.createTeam('org', 'owner', 3, 'team', 'Team')).toThrow('owner');
    expect(() => f.ledger.grantRepository('org', 'other', 3, 'repo', { kind: 'team', id: 'missing' }, 'admin')).toThrow('Team');
    expect(() => f.ledger.resolveAccess('org', 'repo', '')).toThrow();
    expect(f.ledger.snapshot('org')?.revision).toBe(3);
  } finally { f.db.close(); }
});
test('invitations are identity-bound, expire, cannot replay and never demote owners', () => {
  const f = fixture(); try {
    f.ledger.createOrganization('org', 'Org', 'owner');
    f.ledger.invite('org', 'owner', 1, { id: 'i', userId: 'new', role: 'member', expiresAt: 2000 }, 1000);
    expect(() => f.ledger.acceptInvitation('org', 'foreign', 'i', 1500)).toThrow('unavailable');
    expect(() => f.ledger.acceptInvitation('org', 'new', 'i', 2000)).toThrow('unavailable');
    f.ledger.acceptInvitation('org', 'new', 'i', 1500);
    expect(() => f.ledger.acceptInvitation('org', 'new', 'i', 1500)).toThrow('unavailable');
    f.ledger.invite('org', 'owner', 3, { id: 'owner-i', userId: 'owner', role: 'member', expiresAt: 2000 }, 1000);
    f.ledger.acceptInvitation('org', 'owner', 'owner-i', 1500);
    expect(f.ledger.snapshot('org')?.members.find(m => m.userId === 'owner')?.role).toBe('owner');
    f.ledger.invite('org', 'owner', 5, { id: 'revoked', userId: 'another', role: 'member', expiresAt: 2000 }, 1000);
    f.ledger.revokeInvitation('org', 'owner', 6, 'revoked');
    expect(() => f.ledger.acceptInvitation('org', 'another', 'revoked', 1500)).toThrow('unavailable');
  } finally { f.db.close(); }
});
