import { z } from "zod";
const sha = z.string().regex(/^[a-f0-9]{40}$/), id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
export const retainedInputSchema = z.object({ id: z.string().uuid(), projectId: id, incarnation: z.string().uuid(), taskId: id, commit: sha, base: sha, canonicalRepoName: id, workspaceRepoName: id, branch: z.string().min(1).max(200), protectedRef: z.string().max(500), protectedBaseRef: z.string().max(500), workflowId: id, candidateId: id, actorId: z.string().min(1).max(256), ownerId: z.string().min(1).max(256), accountKey: z.string().regex(/^[a-f0-9]{12}$/), followup: z.literal(true).optional(), dependsOn: id.optional(), version: z.literal(1) }).strict();
export type RetainedInput = z.infer<typeof retainedInputSchema>;
export interface RetainedInputReceipt extends RetainedInput {
    verifiedAt: string;
}
export interface RebaseApplication {
    input: RetainedInput;
    commit: string;
    base: string;
    parentAccepted: boolean;
    status: "intent" | "remote_verified" | "applied";
    createdAt: string;
    remoteVerifiedAt?: string;
    appliedAt?: string;
}
/** Only trusted orchestration records receipts after remote ref read-back. */
export class RetainedInputs {
    constructor(private readonly storage: DurableObjectStorage) { storage.sql.exec("CREATE TABLE IF NOT EXISTS retained_inputs(id TEXT PRIMARY KEY,payload TEXT NOT NULL,doc TEXT NOT NULL)"); storage.sql.exec("CREATE INDEX IF NOT EXISTS retained_inputs_candidate ON retained_inputs(json_extract(doc,'$.taskId'),json_extract(doc,'$.candidateId'),json_extract(doc,'$.commit'))"); storage.sql.exec("CREATE TABLE IF NOT EXISTS rebase_applications(id TEXT PRIMARY KEY,payload TEXT NOT NULL,doc TEXT NOT NULL)"); }
    get(id: string): RetainedInputReceipt | null { const row = this.storage.sql.exec<{
        doc: string;
    }>("SELECT doc FROM retained_inputs WHERE id=?", id).toArray()[0]; return row ? JSON.parse(row.doc) as RetainedInputReceipt : null; }
    lookup(taskId: string, candidateId: string, commit: string, base?: string): RetainedInputReceipt | null {
        id.parse(taskId);
        id.parse(candidateId);
        sha.parse(commit);
        if (base)
            sha.parse(base);
        const query = "SELECT doc FROM retained_inputs WHERE json_extract(doc,'$.taskId')=? AND json_extract(doc,'$.candidateId')=? AND json_extract(doc,'$.commit')=?" + (base ? " AND json_extract(doc,'$.base')=?" : "") + " ORDER BY rowid DESC LIMIT 1";
        const row = this.storage.sql.exec<{
            doc: string;
        }>(query, taskId, candidateId, commit, ...(base ? [base] : [])).toArray()[0];
        return row ? JSON.parse(row.doc) as RetainedInputReceipt : null;
    }
    record(input: RetainedInput, proof: {
        commit: string;
        base: string;
    }): RetainedInputReceipt {
        const value = retainedInputSchema.parse(input);
        if (value.followup)
            throw new Error("Accepted followup cannot record input pins");
        if (proof.commit !== value.commit || proof.base !== value.base)
            throw new Error("Retained Git proof does not match input");
        if (value.protectedRef !== `refs/flaregit/inputs/${value.incarnation}/${value.taskId}/${value.commit}` || value.protectedBaseRef !== `refs/flaregit/inputs/${value.incarnation}/${value.taskId}/${value.base}`)
            throw new Error("Retained ref scope changed");
        const payload = JSON.stringify(value);
        return this.storage.transactionSync(() => {
            const old = this.storage.sql.exec<{
                payload: string;
                doc: string;
            }>("SELECT payload,doc FROM retained_inputs WHERE id=?", value.id).toArray()[0];
            if (old) {
                if (old.payload !== payload)
                    throw new Error("Retained receipt identity changed");
                return JSON.parse(old.doc) as RetainedInputReceipt;
            }
            const receipt = { ...value, verifiedAt: new Date().toISOString() };
            this.storage.sql.exec("INSERT INTO retained_inputs VALUES(?,?,?)", value.id, payload, JSON.stringify(receipt));
            return receipt;
        });
    }
    application(id: string): RebaseApplication | null { const row = this.storage.sql.exec<{
        doc: string;
    }>("SELECT doc FROM rebase_applications WHERE id=?", id).toArray()[0]; return row ? JSON.parse(row.doc) as RebaseApplication : null; }
    prepareApplication(input: RetainedInput, commit: string, base: string, parentAccepted: boolean): RebaseApplication {
        const scope = retainedInputSchema.parse(input);
        if (scope.followup)
            throw new Error("Accepted followup cannot prepare rebase");
        sha.parse(commit);
        sha.parse(base);
        z.boolean().parse(parentAccepted);
        const receipt = this.get(scope.id);
        if (!receipt || JSON.stringify(retainedInputSchema.parse((({ verifiedAt: _time, ...value }) => value)(receipt))) !== JSON.stringify(scope))
            throw new Error("Retained receipt required before rebase intent");
        const payload = JSON.stringify({ input: scope, commit, base, parentAccepted });
        return this.storage.transactionSync(() => {
            const old = this.storage.sql.exec<{
                payload: string;
                doc: string;
            }>("SELECT payload,doc FROM rebase_applications WHERE id=?", scope.id).toArray()[0];
            if (old) {
                if (old.payload !== payload)
                    throw new Error("Rebase application identity changed");
                return JSON.parse(old.doc) as RebaseApplication;
            }
            const value: RebaseApplication = { input: scope, commit, base, parentAccepted, status: "intent", createdAt: new Date().toISOString() };
            this.storage.sql.exec("INSERT INTO rebase_applications VALUES(?,?,?)", scope.id, payload, JSON.stringify(value));
            return value;
        });
    }
    remoteVerified(id: string, observedCommit: string): RebaseApplication { return this.storage.transactionSync(() => { const value = this.application(id); if (!value || value.commit !== observedCommit)
        throw new Error("Remote rebase proof changed"); if (value.status !== "intent")
        return value; value.status = "remote_verified"; value.remoteVerifiedAt = new Date().toISOString(); this.storage.sql.exec("UPDATE rebase_applications SET doc=? WHERE id=?", JSON.stringify(value), id); return value; }); }
    applyApplication(id: string, apply: (application: RebaseApplication) => void): RebaseApplication { return this.storage.transactionSync(() => { const value = this.application(id); if (!value || value.status === "intent")
        throw new Error("Remote rebase outcome is unconfirmed"); if (value.status === "applied")
        return value; apply(value); value.status = "applied"; value.appliedAt = new Date().toISOString(); this.storage.sql.exec("UPDATE rebase_applications SET doc=? WHERE id=?", JSON.stringify(value), id); return value; }); }
}
