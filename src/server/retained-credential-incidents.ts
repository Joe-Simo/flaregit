import { retainedInputSchema, type RetainedInput } from "./retained-inputs.js";
export type RetainedCredentialPurpose = "workspace" | "canonical";
export type RetainedCredentialStatus = "issuance_unknown" | "pending" | "revoked" | "expired_unverified";
export interface PendingRetainedCredentialIncident {
    inputId: string;
    purpose: RetainedCredentialPurpose;
    repoName: string;
    accountKey: string;
    token: string;
    expiresAt: number | null;
    attempts: number;
    automaticSweeps: number;
}
type Row = {
    input_id: string;
    purpose: RetainedCredentialPurpose;
    repo_name: string;
    account_key: string;
    payload: string;
    scope: "read" | "write";
    intent_expires_at: number;
    token: string | null;
    fingerprint: string | null;
    expires_at: number | null;
    attempts: number;
    status: RetainedCredentialStatus;
    automatic_sweeps: number;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TTL_MS = 900000, PROVIDER_MAX_TTL_MS = 31536000000;
function key(id: string, purpose: RetainedCredentialPurpose) { if (!uuid.test(id) || (purpose !== "workspace" && purpose !== "canonical"))
    throw new Error("Invalid retained credential identity"); }
async function fingerprint(token: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), v => v.toString(16).padStart(2, "0")).join(""); }
/** Trusted backend only. Secret-bearing batches must never cross a client-facing RPC. */
export class RetainedCredentialIncidents {
    constructor(private readonly storage: DurableObjectStorage) { storage.sql.exec("CREATE TABLE IF NOT EXISTS retained_credential_incidents(input_id TEXT NOT NULL,purpose TEXT NOT NULL,repo_name TEXT NOT NULL,account_key TEXT NOT NULL,payload TEXT NOT NULL,scope TEXT NOT NULL,intent_expires_at INTEGER NOT NULL,token TEXT,fingerprint TEXT,expires_at INTEGER,attempts INTEGER NOT NULL,status TEXT NOT NULL,PRIMARY KEY(input_id,purpose))"); if (!storage.sql.exec<{
        name: string;
    }>("PRAGMA table_info(retained_credential_incidents)").toArray().some(row => row.name === "automatic_sweeps"))
        storage.sql.exec("ALTER TABLE retained_credential_incidents ADD COLUMN automatic_sweeps INTEGER NOT NULL DEFAULT 0"); }
    private row(id: string, purpose: RetainedCredentialPurpose) { key(id, purpose); return this.storage.sql.exec<Row>("SELECT * FROM retained_credential_incidents WHERE input_id=? AND purpose=?", id, purpose).toArray()[0]; }
    /** Durable immutable intent BEFORE provider issuance; validate current pin synchronously here. */
    begin(input: RetainedInput, purpose: RetainedCredentialPurpose, expiresAt: number, scope: "read" | "write", validate?: () => void, now = Date.now()): boolean {
        const value = retainedInputSchema.parse(input);
        key(value.id, purpose);
        if (value.protectedRef !== `refs/flaregit/inputs/${value.incarnation}/${value.taskId}/${value.commit}` || value.protectedBaseRef !== `refs/flaregit/inputs/${value.incarnation}/${value.taskId}/${value.base}` || !Number.isSafeInteger(now) || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + TTL_MS || (scope !== "read" && scope !== "write") || (value.followup && (purpose !== "canonical" || scope !== "read")))
            throw new Error("Invalid retained credential issuance intent");
        const payload = JSON.stringify(value), repoName = purpose === "workspace" ? value.workspaceRepoName : value.canonicalRepoName;
        return this.storage.transactionSync(() => {
            validate?.();
            const old = this.row(value.id, purpose);
            if (old) {
                if (old.payload !== payload || old.scope !== scope || old.repo_name !== repoName || old.intent_expires_at !== expiresAt)
                    throw new Error("Retained credential intent changed");
                return false;
            }
            if (this.storage.sql.exec<{
                count: number;
            }>("SELECT COUNT(*) AS count FROM retained_credential_incidents").one().count >= 1000)
                throw new Error("Retained credential incident limit reached");
            this.storage.sql.exec("INSERT INTO retained_credential_incidents(input_id,purpose,repo_name,account_key,payload,scope,intent_expires_at,token,fingerprint,expires_at,attempts,status) VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL,0,'issuance_unknown')", value.id, purpose, repoName, value.accountKey, payload, scope, expiresAt);
            return true;
        });
    }
    /** Store cleanup capability even after authority withdrawal. Exact intent is the authority;
     * invalid provider expiry remains unknown, so an issued secret is never silently discarded. */
    async record(id: string, purpose: RetainedCredentialPurpose, repoName: string, token: string, expiresAt: number, validate?: () => void, now?: number): Promise<void> {
        key(id, purpose);
        if (typeof token !== "string" || !token || token.length > 16384 || /[\r\n\0]/.test(token))
            throw new Error("Invalid retained credential receipt");
        const digest = await fingerprint(token);
        this.storage.transactionSync(() => {
            validate?.();
            const currentNow = now ?? Date.now();
            if (!Number.isSafeInteger(currentNow))
                throw new Error("Invalid retained credential time");
            const row = this.row(id, purpose);
            if (!row || row.repo_name !== repoName)
                throw new Error("Retained credential receipt has no exact issuance intent");
            const expiry = Number.isSafeInteger(expiresAt) && expiresAt >= 0 && expiresAt <= currentNow + PROVIDER_MAX_TTL_MS ? expiresAt : null;
            if (row.fingerprint) {
                if (row.fingerprint !== digest || row.expires_at !== expiry || (row.token !== null && row.token !== token))
                    throw new Error("Retained credential receipt changed");
                return;
            }
            const expired = expiry !== null && expiry <= currentNow;
            this.storage.sql.exec("UPDATE retained_credential_incidents SET token=?,fingerprint=?,expires_at=?,status=? WHERE input_id=? AND purpose=?", expired ? null : token, digest, expiry, expired ? "expired_unverified" : "pending", id, purpose);
        });
    }
    /** Alarm only: bounded retries; no expiry claim for an issuance whose response was lost. */
    pendingBatch(now = Date.now()): PendingRetainedCredentialIncident[] {
        if (!Number.isSafeInteger(now))
            throw new Error("Invalid retained credential time");
        return this.storage.transactionSync(() => {
            this.storage.sql.exec("UPDATE retained_credential_incidents SET token=NULL,status='expired_unverified' WHERE status='pending' AND expires_at IS NOT NULL AND expires_at<=?", now);
            return this.storage.sql.exec<Row>("SELECT * FROM retained_credential_incidents WHERE status='pending' AND attempts<4 AND automatic_sweeps<4 ORDER BY COALESCE(expires_at,9223372036854775807),input_id,purpose LIMIT 20").toArray().map(row => ({ inputId: row.input_id, purpose: row.purpose, repoName: row.repo_name, accountKey: row.account_key, token: row.token!, expiresAt: row.expires_at, attempts: row.attempts, automaticSweeps: row.automatic_sweeps }));
        });
    }
    /** Claim an automatic opportunity before funding. Denied funding also consumes
     * this separate cap, without pretending a provider revoke was attempted. */
    markAutomaticSweep(id: string, purpose: RetainedCredentialPurpose): boolean { return this.storage.transactionSync(() => { const row = this.row(id, purpose); if (!row)
        throw new Error("Unknown retained credential intent"); if (row.status !== "pending" || row.attempts >= 4 || row.automatic_sweeps >= 4)
        return false; this.storage.sql.exec("UPDATE retained_credential_incidents SET automatic_sweeps=automatic_sweeps+1 WHERE input_id=? AND purpose=?", id, purpose); return true; }); }
    /** Absolute next wake, independent of unsafe pending state. Exhausted unknown
     * expiry retains its secret and uncertainty without an endless alarm loop. */
    nextWake(now = Date.now()): number | null {
        if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - 120000)
            throw new Error("Invalid retained credential time");
        return this.storage.transactionSync(() => {
            this.storage.sql.exec("UPDATE retained_credential_incidents SET token=NULL,status='expired_unverified' WHERE status='pending' AND expires_at IS NOT NULL AND expires_at<=?", now);
            const rows = this.storage.sql.exec<Pick<Row, "expires_at" | "attempts" | "automatic_sweeps">>("SELECT expires_at,attempts,automatic_sweeps FROM retained_credential_incidents WHERE status='pending'").toArray();
            let wake: number | null = null;
            for (const row of rows) {
                const retry = row.attempts < 4 && row.automatic_sweeps < 4 ? now + 120000 : null;
                const candidate = retry === null ? row.expires_at : row.expires_at === null ? retry : Math.min(retry, row.expires_at);
                if (candidate !== null && (wake === null || candidate < wake))
                    wake = candidate;
            }
            return wake;
        });
    }
    /** Explicit trusted cleanup may use its remaining provider attempts after the
     * automatic sweep cap. This grants no extra attempts and never resets a cap. */
    credentialForRevocation(id: string, purpose: RetainedCredentialPurpose, now = Date.now()): PendingRetainedCredentialIncident | null {
        if (!Number.isSafeInteger(now) || now < 0)
            throw new Error("Invalid retained credential time");
        return this.storage.transactionSync(() => {
            const row = this.row(id, purpose);
            if (!row || row.status !== "pending" || row.attempts >= 4 || !row.token)
                return null;
            if (row.expires_at !== null && row.expires_at <= now) {
                this.storage.sql.exec("UPDATE retained_credential_incidents SET token=NULL,status='expired_unverified' WHERE input_id=? AND purpose=?", id, purpose);
                return null;
            }
            return { inputId: row.input_id, purpose: row.purpose, repoName: row.repo_name, accountKey: row.account_key, token: row.token, expiresAt: row.expires_at, attempts: row.attempts, automaticSweeps: row.automatic_sweeps };
        });
    }
    markAttempt(id: string, purpose: RetainedCredentialPurpose): boolean { return this.storage.transactionSync(() => { const row = this.row(id, purpose); if (!row)
        throw new Error("Unknown retained credential intent"); if (row.status !== "pending" || row.attempts >= 4)
        return false; this.storage.sql.exec("UPDATE retained_credential_incidents SET attempts=attempts+1 WHERE input_id=? AND purpose=?", id, purpose); return true; }); }
    async markRevoked(id: string, purpose: RetainedCredentialPurpose, token: string): Promise<void> {
        const digest = await fingerprint(token);
        this.storage.transactionSync(() => { const row = this.row(id, purpose); if (!row || row.fingerprint !== digest || (row.token !== null && row.token !== token))
            throw new Error("Retained credential revocation receipt mismatch"); if (row.status === "expired_unverified")
            throw new Error("Retained credential expiry is unverified"); this.storage.sql.exec("UPDATE retained_credential_incidents SET token=NULL,status='revoked' WHERE input_id=? AND purpose=?", id, purpose); });
    }
    /** Historical preservation proof only, never a fresh credential grant. The
     * exact server-normalized authorized scope must have an actual issuance receipt. */
    canonicalWriteIssued(input: RetainedInput): boolean {
        const parsed = retainedInputSchema.safeParse(input);
        if (!parsed.success)
            return false;
        const value = parsed.data, row = this.row(value.id, "canonical");
        return !!row && row.payload === JSON.stringify(value) && row.scope === "write" && row.repo_name === value.canonicalRepoName && row.account_key === value.accountKey && row.status !== "issuance_unknown" && row.fingerprint !== null && /^[a-f0-9]{64}$/.test(row.fingerprint);
    }
    summary(id: string, purpose: RetainedCredentialPurpose): {
        status: RetainedCredentialStatus;
        expiresAt: number | null;
        fingerprint: string | null;
    } | null { const row = this.row(id, purpose); return row ? { status: row.status, expiresAt: row.expires_at, fingerprint: row.fingerprint } : null; }
    hasPending(): boolean { return this.storage.sql.exec("SELECT input_id FROM retained_credential_incidents WHERE status='pending' LIMIT 1").toArray().length > 0; }
}
