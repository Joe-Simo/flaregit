import { z } from 'zod';
const id = z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
export const initialForkCredentialScopeSchema = z.object({ eventId: z.uuid(), allocationId: z.uuid(), taskId: id, projectId: id, incarnation: z.uuid(), canonicalRepoName: id, workspaceRepoName: id, accountKey: id, actorId: z.string().min(1).max(256).regex(/^[^\x00-\x1f\x7f]+$/) }).strict();
export type InitialForkCredentialScope = z.infer<typeof initialForkCredentialScopeSchema>;
export type InitialForkCredentialStatus = 'issuance_unknown' | 'pending' | 'revoked';
type Row = { event_id: string; payload: string; status: InitialForkCredentialStatus; token: string | null; fingerprint: string | null; attempts: number; automatic_sweeps: number };
export interface PendingInitialForkCredential { scope: InitialForkCredentialScope; token: string }
async function fingerprint(token: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join(''); }
function tokenValue(token: string) { if (typeof token !== 'string' || !token || token.length > 16384 || /[\x00-\x20\x7f]/.test(token)) throw Error('Initial fork credential receipt unavailable'); }
/** Artifacts fork returns only an initial plaintext token, with no scope or
 * expiry receipt. Never infer a lifetime or expose/use it as a contribution
 * credential. Only positively confirmed revocation settles this intent.
 * Secret-bearing batches are trusted backend cleanup inputs, never UI data.
 */
export class InitialForkCredentials {
  constructor(private readonly storage: DurableObjectStorage) { storage.sql.exec('CREATE TABLE IF NOT EXISTS initial_fork_credentials(event_id TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL,token TEXT,fingerprint TEXT,attempts INTEGER NOT NULL DEFAULT 0,automatic_sweeps INTEGER NOT NULL DEFAULT 0)'); }
  private row(eventId: string) { z.uuid().parse(eventId); return this.storage.sql.exec<Row>('SELECT * FROM initial_fork_credentials WHERE event_id=?', eventId).toArray()[0]; }
  /** Persist before fork dispatch. False is an existing immutable issuance intent,
   * not permission to repeat the fork or assume no credential was issued. */
  begin(scope: InitialForkCredentialScope, validate: () => void): boolean {
    const checked = initialForkCredentialScopeSchema.parse(scope), payload = JSON.stringify(checked);
    return this.storage.transactionSync(() => {
      validate(); const old = this.row(checked.eventId);
      if (old) { if (old.payload !== payload) throw Error('Initial fork credential intent changed'); return false; }
      if (this.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM initial_fork_credentials').toArray()[0]!.n >= 10000) throw Error('Initial fork credential audit capacity reached; unresolved receipts remain preserved');
      this.storage.sql.exec("INSERT INTO initial_fork_credentials(event_id,payload,status) VALUES(?,?,'issuance_unknown')", checked.eventId, payload); return true;
    });
  }
  /** Immutable pre-dispatch intent grants cleanup recording after a late ACK or
   * actor withdrawal. This does not restore creation/use authorization. */
  async record(scope: InitialForkCredentialScope, token: string): Promise<void> {
    const checked = initialForkCredentialScopeSchema.parse(scope), payload = JSON.stringify(checked); tokenValue(token);
    // Persist the returned secret before the first asynchronous operation. A
    // failed digest or interrupted caller must retain exact cleanup capability.
    this.storage.transactionSync(() => {
      const row = this.row(checked.eventId); if (!row || row.payload !== payload) throw Error('Initial fork credential has no exact issuance intent');
      if (row.token !== null && row.token !== token) throw Error('Initial fork credential receipt changed');
      if (row.status === 'revoked') { if (!row.token && !row.fingerprint) throw Error('Initial fork revocation receipt unavailable'); return; }
      if (row.token === null) this.storage.sql.exec("UPDATE initial_fork_credentials SET status='pending',token=? WHERE event_id=?", token, checked.eventId);
    });
    await this.enrichFingerprint(checked, token);
  }
  private async enrichFingerprint(scope: InitialForkCredentialScope, token: string): Promise<void> {
    const hash = await fingerprint(token);
    this.storage.transactionSync(() => {
      const row = this.row(scope.eventId);
      if (!row || row.payload !== JSON.stringify(scope) || (row.token !== null && row.token !== token) || (row.fingerprint !== null && row.fingerprint !== hash)) throw Error('Initial fork credential receipt changed');
      if (row.status !== 'revoked' && row.token === null) throw Error('Initial fork credential receipt unavailable');
      this.storage.sql.exec('UPDATE initial_fork_credentials SET fingerprint=?,token=? WHERE event_id=?', hash, row.status === 'revoked' ? null : token, scope.eventId);
    });
  }
  credentialForRevocation(eventId: string): PendingInitialForkCredential | null {
    const row = this.row(eventId); return row?.status === 'pending' && row.token ? { scope: JSON.parse(row.payload) as InitialForkCredentialScope, token: row.token } : null;
  }
  /** Fund revocation independently of current creation authority. False, timeout,
   * wrong repository and absent receipts all retain the credential hold. */
  async markRevoked(scope: InitialForkCredentialScope, token: string, proof: { repoName: string; revoked: boolean }): Promise<boolean> {
    const checked = initialForkCredentialScopeSchema.parse(scope); tokenValue(token); if (proof.revoked !== true || proof.repoName !== checked.workspaceRepoName) return false;
    // Record the positive SDK receipt synchronously as well. If enrichment fails,
    // the revoked secret remains backend-only until the same receipt is retried.
    this.storage.transactionSync(() => {
      const row = this.row(checked.eventId);
      if (!row || row.payload !== JSON.stringify(checked) || (row.token !== null && row.token !== token) || (row.token === null && row.status !== 'revoked')) throw Error('Initial fork credential revocation scope changed');
      if (row.status !== 'revoked') this.storage.sql.exec("UPDATE initial_fork_credentials SET status='revoked' WHERE event_id=?", checked.eventId);
    });
    await this.enrichFingerprint(checked, token);
    return true;
  }
  settled(scope: InitialForkCredentialScope): boolean { const checked = initialForkCredentialScopeSchema.parse(scope), row = this.row(checked.eventId); return !!row && row.payload === JSON.stringify(checked) && row.status === 'revoked'; }
  markAttempt(eventId: string): boolean { return this.storage.transactionSync(() => { const row = this.row(eventId); if (row?.status !== 'pending' || row.attempts >= Number.MAX_SAFE_INTEGER) return false; this.storage.sql.exec('UPDATE initial_fork_credentials SET attempts=attempts+1 WHERE event_id=?', eventId); return true; }); }
  markAutomaticSweep(eventId: string): boolean { return this.storage.transactionSync(() => { const row = this.row(eventId); if (row?.status !== 'pending' || row.automatic_sweeps >= 4) return false; this.storage.sql.exec('UPDATE initial_fork_credentials SET automatic_sweeps=automatic_sweeps+1 WHERE event_id=?', eventId); return true; }); }
  pendingBatch(): PendingInitialForkCredential[] { return this.storage.sql.exec<Row>("SELECT * FROM initial_fork_credentials WHERE status='pending' AND automatic_sweeps<4 ORDER BY event_id LIMIT 20").toArray().map(row => ({ scope: JSON.parse(row.payload) as InitialForkCredentialScope, token: row.token! })); }
  nextWake(now = Date.now()): number | null { if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid initial fork cleanup clock'); return this.storage.sql.exec("SELECT event_id FROM initial_fork_credentials WHERE status='pending' AND automatic_sweeps<4 LIMIT 1").toArray().length ? now + 120000 : null; }
  summary(eventId: string): { status: InitialForkCredentialStatus; attempts: number; automaticSweeps: number; providerScope: 'unverified'; expiresAt: null } | null { const row = this.row(eventId); return row ? { status: row.status, attempts: row.attempts, automaticSweeps: row.automatic_sweeps, providerScope: 'unverified', expiresAt: null } : null; }
}
