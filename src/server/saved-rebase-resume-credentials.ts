import { createHash } from "node:crypto";
import { z } from "zod";

const identity = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_.:-]+$/);
const repo = z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
export const savedRebaseResumeCredentialIntentSchema = z.object({
    attemptId: z.uuid(), applicationId: z.uuid(), projectId: identity, incarnation: z.uuid(),
    accountKey: identity, canonicalRepoName: repo, workspaceRepoName: repo, actorId: identity,
}).strict().refine(value => value.canonicalRepoName !== value.workspaceRepoName, "Workspace must be isolated");
export type SavedRebaseResumeCredentialIntent = z.infer<typeof savedRebaseResumeCredentialIntentSchema>;
export type SavedRebaseResumeCredentialPurpose = "workspace" | "canonical";
export type SavedRebaseResumeCredentialStatus = "issuance_unknown" | "pending" | "revoked" | "expired_unverified";
export interface PendingSavedRebaseResumeCredentialIncident {
    attemptId: string;
    purpose: SavedRebaseResumeCredentialPurpose;
    repoName: string;
    accountKey: string;
    token: string;
    expiresAt: number | null;
    attempts: number;
    automaticSweeps: number;
}
type Row = {
    attempt_id: string;
    purpose: SavedRebaseResumeCredentialPurpose;
    repo_name: string;
    account_key: string;
    payload: string;
    scope: "read" | "write";
    intent_expires_at: number;
    token: string | null;
    fingerprint: string | null;
    expires_at: number | null;
    attempts: number;
    status: SavedRebaseResumeCredentialStatus;
    automatic_sweeps: number;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TTL_MS = 900000, PROVIDER_MAX_TTL_MS = 31536000000;
function key(id: string, purpose: SavedRebaseResumeCredentialPurpose) { if (!uuid.test(id) || (purpose !== "workspace" && purpose !== "canonical"))
    throw new Error("Invalid saved rebase resume credential identity"); }
function fingerprint(token: string) { return createHash("sha256").update(token).digest("hex"); }
/** Trusted backend only. Secret-bearing batches must never cross a client-facing RPC. */
export class SavedRebaseResumeCredentials {
    constructor(private readonly storage: DurableObjectStorage) { storage.sql.exec("CREATE TABLE IF NOT EXISTS saved_rebase_resume_credentials(attempt_id TEXT NOT NULL,purpose TEXT NOT NULL,repo_name TEXT NOT NULL,account_key TEXT NOT NULL,payload TEXT NOT NULL,scope TEXT NOT NULL,intent_expires_at INTEGER NOT NULL,token TEXT,fingerprint TEXT,expires_at INTEGER,attempts INTEGER NOT NULL,status TEXT NOT NULL,PRIMARY KEY(attempt_id,purpose))"); if (!storage.sql.exec<{
        name: string;
    }>("PRAGMA table_info(saved_rebase_resume_credentials)").toArray().some(row => row.name === "automatic_sweeps"))
        storage.sql.exec("ALTER TABLE saved_rebase_resume_credentials ADD COLUMN automatic_sweeps INTEGER NOT NULL DEFAULT 0"); }
    private row(id: string, purpose: SavedRebaseResumeCredentialPurpose) { key(id, purpose); return this.storage.sql.exec<Row>("SELECT * FROM saved_rebase_resume_credentials WHERE attempt_id=? AND purpose=?", id, purpose).toArray()[0]; }
    /** Durable immutable intent BEFORE provider issuance; validate current pin synchronously here. */
    begin(input: SavedRebaseResumeCredentialIntent, purpose: SavedRebaseResumeCredentialPurpose, expiresAt: number, validate?: () => void, now = Date.now()): boolean {
        const value = savedRebaseResumeCredentialIntentSchema.parse(input);
        key(value.attemptId, purpose);
        if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + TTL_MS)
            throw new Error("Invalid saved rebase resume credential issuance intent");
        const payload = JSON.stringify(value), repoName = purpose === "workspace" ? value.workspaceRepoName : value.canonicalRepoName;
        const scope = purpose === "canonical" ? "read" : "write";
        return this.storage.transactionSync(() => {
            validate?.();
            const old = this.row(value.attemptId, purpose);
            if (old) {
                if (old.payload !== payload || old.scope !== scope || old.repo_name !== repoName || old.intent_expires_at !== expiresAt)
                    throw new Error("Saved rebase resume credential intent changed");
                return false;
            }
            if (this.storage.sql.exec<{count: number}>("SELECT COUNT(*) AS count FROM saved_rebase_resume_credentials").one().count >= 1000)
                throw new Error("Saved rebase resume credential incident limit reached");
            this.storage.sql.exec("INSERT INTO saved_rebase_resume_credentials(attempt_id,purpose,repo_name,account_key,payload,scope,intent_expires_at,token,fingerprint,expires_at,attempts,status) VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL,0,'issuance_unknown')", value.attemptId, purpose, repoName, value.accountKey, payload, scope, expiresAt);
            return true;
        });
    }
    /** Synchronously journal the returned secret before caller validates provider scope or expiry.
     * No authority callback may discard an already issued cleanup capability. Exact intent is the authority;
     * invalid provider expiry remains unknown, so an issued secret is never silently discarded. */
    async record(id: string, purpose: SavedRebaseResumeCredentialPurpose, repoName: string, token: string, expiresAt: number, now?: number): Promise<void> {
        key(id, purpose);
        if (typeof token !== "string" || !token || token.length > 16384 || /[\r\n\0]/.test(token))
            throw new Error("Invalid saved rebase resume credential receipt");
        const digest = fingerprint(token);
        this.storage.transactionSync(() => {
            const currentNow = now ?? Date.now();
            if (!Number.isSafeInteger(currentNow))
                throw new Error("Invalid saved rebase resume credential time");
            const row = this.row(id, purpose);
            if (!row || row.repo_name !== repoName)
                throw new Error("Saved rebase resume credential receipt has no exact issuance intent");
            const expiry = Number.isSafeInteger(expiresAt) && expiresAt >= 0 && expiresAt <= currentNow + PROVIDER_MAX_TTL_MS ? expiresAt : null;
            if (row.fingerprint) {
                if (row.fingerprint !== digest || row.expires_at !== expiry || (row.token !== null && row.token !== token))
                    throw new Error("Saved rebase resume credential receipt changed");
                return;
            }
            const expired = expiry !== null && expiry <= currentNow;
            this.storage.sql.exec("UPDATE saved_rebase_resume_credentials SET token=?,fingerprint=?,expires_at=?,status=? WHERE attempt_id=? AND purpose=?", expired ? null : token, digest, expiry, expired ? "expired_unverified" : "pending", id, purpose);
        });
    }
    /** Alarm only: bounded retries; no expiry claim for an issuance whose response was lost. */
    pendingBatch(now = Date.now()): PendingSavedRebaseResumeCredentialIncident[] {
        if (!Number.isSafeInteger(now))
            throw new Error("Invalid saved rebase resume credential time");
        return this.storage.transactionSync(() => {
            this.storage.sql.exec("UPDATE saved_rebase_resume_credentials SET token=NULL,status='expired_unverified' WHERE status='pending' AND expires_at IS NOT NULL AND expires_at<=?", now);
            return this.storage.sql.exec<Row>("SELECT * FROM saved_rebase_resume_credentials WHERE status='pending' AND attempts<4 AND automatic_sweeps<4 ORDER BY COALESCE(expires_at,9223372036854775807),attempt_id,purpose LIMIT 20").toArray().map(row => ({ attemptId: row.attempt_id, purpose: row.purpose, repoName: row.repo_name, accountKey: row.account_key, token: row.token!, expiresAt: row.expires_at, attempts: row.attempts, automaticSweeps: row.automatic_sweeps }));
        });
    }
    /** Claim an automatic opportunity before funding. Denied funding also consumes
     * this separate cap, without pretending a provider revoke was attempted. */
    markAutomaticSweep(id: string, purpose: SavedRebaseResumeCredentialPurpose): boolean { return this.storage.transactionSync(() => { const row = this.row(id, purpose); if (!row)
        throw new Error("Unknown saved rebase resume credential intent"); if (row.status !== "pending" || row.attempts >= 4 || row.automatic_sweeps >= 4)
        return false; this.storage.sql.exec("UPDATE saved_rebase_resume_credentials SET automatic_sweeps=automatic_sweeps+1 WHERE attempt_id=? AND purpose=?", id, purpose); return true; }); }
    /** Absolute next wake, independent of unsafe pending state. Exhausted unknown
     * expiry retains its secret and uncertainty without an endless alarm loop. */
    nextWake(now = Date.now()): number | null {
        if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - 120000)
            throw new Error("Invalid saved rebase resume credential time");
        return this.storage.transactionSync(() => {
            this.storage.sql.exec("UPDATE saved_rebase_resume_credentials SET token=NULL,status='expired_unverified' WHERE status='pending' AND expires_at IS NOT NULL AND expires_at<=?", now);
            const rows = this.storage.sql.exec<Pick<Row, "expires_at" | "attempts" | "automatic_sweeps">>("SELECT expires_at,attempts,automatic_sweeps FROM saved_rebase_resume_credentials WHERE status='pending'").toArray();
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
    credentialForRevocation(id: string, purpose: SavedRebaseResumeCredentialPurpose, now = Date.now()): PendingSavedRebaseResumeCredentialIncident | null {
        if (!Number.isSafeInteger(now) || now < 0)
            throw new Error("Invalid saved rebase resume credential time");
        return this.storage.transactionSync(() => {
            const row = this.row(id, purpose);
            if (!row || row.status !== "pending" || row.attempts >= 4 || !row.token)
                return null;
            if (row.expires_at !== null && row.expires_at <= now) {
                this.storage.sql.exec("UPDATE saved_rebase_resume_credentials SET token=NULL,status='expired_unverified' WHERE attempt_id=? AND purpose=?", id, purpose);
                return null;
            }
            return { attemptId: row.attempt_id, purpose: row.purpose, repoName: row.repo_name, accountKey: row.account_key, token: row.token, expiresAt: row.expires_at, attempts: row.attempts, automaticSweeps: row.automatic_sweeps };
        });
    }
    markAttempt(id: string, purpose: SavedRebaseResumeCredentialPurpose): boolean { return this.storage.transactionSync(() => { const row = this.row(id, purpose); if (!row)
        throw new Error("Unknown saved rebase resume credential intent"); if (row.status !== "pending" || row.attempts >= 4)
        return false; this.storage.sql.exec("UPDATE saved_rebase_resume_credentials SET attempts=attempts+1 WHERE attempt_id=? AND purpose=?", id, purpose); return true; }); }
    async markRevoked(id: string, purpose: SavedRebaseResumeCredentialPurpose, token: string): Promise<void> {
        const digest = fingerprint(token);
        this.storage.transactionSync(() => { const row = this.row(id, purpose); if (!row || row.fingerprint !== digest || (row.token !== null && row.token !== token))
            throw new Error("Saved rebase resume credential revocation receipt mismatch"); if (row.status === "expired_unverified")
            throw new Error("Saved rebase resume credential expiry is unverified"); this.storage.sql.exec("UPDATE saved_rebase_resume_credentials SET token=NULL,status='revoked' WHERE attempt_id=? AND purpose=?", id, purpose); });
    }
    summary(id: string, purpose: SavedRebaseResumeCredentialPurpose): {
        status: SavedRebaseResumeCredentialStatus;
        expiresAt: number | null;
        fingerprint: string | null;
    } | null { const row = this.row(id, purpose); return row ? { status: row.status, expiresAt: row.expires_at, fingerprint: row.fingerprint } : null; }
    /** Actual provider expiry releases deletion without inventing a revocation receipt.
     * Unknown issuance/expiry and unerased secrets remain fenced. */
    hasPending(now = Date.now()): boolean {
        if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid saved rebase resume credential time");
        return this.storage.transactionSync(() => {
            this.storage.sql.exec("UPDATE saved_rebase_resume_credentials SET token=NULL,status='expired_unverified' WHERE status='pending' AND expires_at IS NOT NULL AND expires_at<=?", now);
            return this.storage.sql.exec("SELECT attempt_id FROM saved_rebase_resume_credentials WHERE status!='revoked' AND (status!='expired_unverified' OR expires_at IS NULL OR expires_at>? OR token IS NOT NULL OR fingerprint IS NULL) LIMIT 1", now).toArray().length > 0;
        });
    }
}
