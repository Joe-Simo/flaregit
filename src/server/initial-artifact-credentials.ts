import { z } from 'zod';
export type InitialArtifactCredentialStatus = 'issuance_unknown' | 'pending' | 'revoked';
type Row = { event_id: string; payload: string; status: InitialArtifactCredentialStatus; token: string | null; fingerprint: string | null; attempts: number; automatic_sweeps: number };
export interface PendingInitialArtifactCredential<Scope> { scope: Scope; token: string }
async function fingerprint(token: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join(''); }
function tokenValue(token: string) { if (typeof token !== 'string' || !token || token.length > 16384 || /[\x00-\x20\x7f]/.test(token)) throw Error('Initial fork credential receipt unavailable'); }
/** Artifacts fork returns only an initial plaintext token, with no scope or
 * expiry receipt. Never infer a lifetime or expose/use it as a contribution
 * credential. Only positively confirmed revocation settles this intent.
 * Secret-bearing batches are trusted backend cleanup inputs, never UI data.
 */
export class InitialArtifactCredentials<Scope extends { eventId: string }> {
  constructor(private readonly storage: DurableObjectStorage, private readonly options: { table: 'initial_fork_credentials' | 'initial_repository_credentials' | 'initial_repository_read_credentials'; parse(value: unknown): Scope; repositoryName(scope: Scope): string }) { if (!['initial_fork_credentials','initial_repository_credentials','initial_repository_read_credentials'].includes(options.table)) throw Error('Invalid initial credential ledger'); this.table=options.table; storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${this.table}(event_id TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL,token TEXT,fingerprint TEXT,attempts INTEGER NOT NULL DEFAULT 0,automatic_sweeps INTEGER NOT NULL DEFAULT 0)`); }
  private readonly table: 'initial_fork_credentials' | 'initial_repository_credentials' | 'initial_repository_read_credentials';
  private row(eventId: string) { z.uuid().parse(eventId); return this.storage.sql.exec<Row>(`SELECT * FROM ${this.table} WHERE event_id=?`, eventId).toArray()[0]; }
  /** Persist before fork dispatch. False is an existing immutable issuance intent,
   * not permission to repeat the fork or assume no credential was issued. */
  begin(scope: Scope, validate: () => void): boolean {
    const checked = this.options.parse(scope), payload = JSON.stringify(checked);
    return this.storage.transactionSync(() => {
      validate(); const old = this.row(checked.eventId);
      if (old) { if (old.payload !== payload) throw Error('Initial fork credential intent changed'); return false; }
      if (this.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${this.table}`).toArray()[0]!.n >= 10000) throw Error('Initial fork credential audit capacity reached; unresolved receipts remain preserved');
      this.storage.sql.exec(`INSERT INTO ${this.table}(event_id,payload,status) VALUES(?,?,'issuance_unknown')`, checked.eventId, payload); return true;
    });
  }
  /** Immutable pre-dispatch intent grants cleanup recording after a late ACK or
   * actor withdrawal. This does not restore creation/use authorization. */
  async record(scope: Scope, token: string): Promise<void> {
    const checked = this.options.parse(scope), payload = JSON.stringify(checked); tokenValue(token);
    // Persist the returned secret before the first asynchronous operation. A
    // failed digest or interrupted caller must retain exact cleanup capability.
    this.storage.transactionSync(() => {
      const row = this.row(checked.eventId); if (!row || row.payload !== payload) throw Error('Initial fork credential has no exact issuance intent');
      if (row.token !== null && row.token !== token) throw Error('Initial fork credential receipt changed');
      if (row.status === 'revoked') { if (!row.token && !row.fingerprint) throw Error('Initial fork revocation receipt unavailable'); return; }
      if (row.token === null) this.storage.sql.exec(`UPDATE ${this.table} SET status='pending',token=? WHERE event_id=?`, token, checked.eventId);
    });
    await this.enrichFingerprint(checked, token);
  }
  private async enrichFingerprint(scope: Scope, token: string): Promise<void> {
    const hash = await fingerprint(token);
    this.storage.transactionSync(() => {
      const row = this.row(scope.eventId);
      if (!row || row.payload !== JSON.stringify(scope) || (row.token !== null && row.token !== token) || (row.fingerprint !== null && row.fingerprint !== hash)) throw Error('Initial fork credential receipt changed');
      if (row.status !== 'revoked' && row.token === null) throw Error('Initial fork credential receipt unavailable');
      this.storage.sql.exec(`UPDATE ${this.table} SET fingerprint=?,token=? WHERE event_id=?`, hash, row.status === 'revoked' ? null : token, scope.eventId);
    });
  }
  credentialForRevocation(eventId: string): PendingInitialArtifactCredential<Scope> | null {
    const row = this.row(eventId); return row?.status === 'pending' && row.token ? { scope: JSON.parse(row.payload) as Scope, token: row.token } : null;
  }
  /** Fund revocation independently of current creation authority. False, timeout,
   * wrong repository and absent receipts all retain the credential hold. */
  async markRevoked(scope: Scope, token: string, proof: { repoName: string; revoked: boolean }): Promise<boolean> {
    const checked = this.options.parse(scope); tokenValue(token); if (proof.revoked !== true || proof.repoName !== this.options.repositoryName(checked)) return false;
    // Record the positive SDK receipt synchronously as well. If enrichment fails,
    // the revoked secret remains backend-only until the same receipt is retried.
    this.storage.transactionSync(() => {
      const row = this.row(checked.eventId);
      if (!row || row.payload !== JSON.stringify(checked) || (row.token !== null && row.token !== token) || (row.token === null && row.status !== 'revoked')) throw Error('Initial fork credential revocation scope changed');
      if (row.status !== 'revoked') this.storage.sql.exec(`UPDATE ${this.table} SET status='revoked' WHERE event_id=?`, checked.eventId);
    });
    await this.enrichFingerprint(checked, token);
    return true;
  }
  settled(scope: Scope): boolean { const checked = this.options.parse(scope), row = this.row(checked.eventId); return !!row && row.payload === JSON.stringify(checked) && row.status === 'revoked'; }
  markAttempt(eventId: string): boolean { return this.storage.transactionSync(() => { const row = this.row(eventId); if (row?.status !== 'pending' || row.attempts >= Number.MAX_SAFE_INTEGER) return false; this.storage.sql.exec(`UPDATE ${this.table} SET attempts=attempts+1 WHERE event_id=?`, eventId); return true; }); }
  markAutomaticSweep(eventId: string): boolean { return this.storage.transactionSync(() => { const row = this.row(eventId); if (row?.status !== 'pending' || row.automatic_sweeps >= 4) return false; this.storage.sql.exec(`UPDATE ${this.table} SET automatic_sweeps=automatic_sweeps+1 WHERE event_id=?`, eventId); return true; }); }
  pendingBatch(): PendingInitialArtifactCredential<Scope>[] { return this.storage.sql.exec<Row>(`SELECT * FROM ${this.table} WHERE status='pending' AND automatic_sweeps<4 ORDER BY event_id LIMIT 20`).toArray().map(row => ({ scope: JSON.parse(row.payload) as Scope, token: row.token! })); }
  nextWake(now = Date.now()): number | null { if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid initial fork cleanup clock'); return this.storage.sql.exec(`SELECT event_id FROM ${this.table} WHERE status='pending' AND automatic_sweeps<4 LIMIT 1`).toArray().length ? now + 120000 : null; }
  summary(eventId: string): { status: InitialArtifactCredentialStatus; attempts: number; automaticSweeps: number; providerScope: 'unverified'; expiresAt: null } | null { const row = this.row(eventId); return row ? { status: row.status, attempts: row.attempts, automaticSweeps: row.automatic_sweeps, providerScope: 'unverified', expiresAt: null } : null; }
}
