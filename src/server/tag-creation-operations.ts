import { z } from "zod";
import { tagCreationSchema, type TagCreationIdentity, type TagGitObservation,tagNativeOwnershipSchema,type TagNativeOwnership } from "./tag-git";

export interface TagCreationOperation extends TagCreationIdentity {
  phase: "prepared" | "unknown" | "confirmed" | "refused";
  native?:TagNativeOwnership&{stopped:boolean};
  createdAt: number;
  reason?: "existing_ref" | "different_ref" | "owner_abandoned_prepared";
  observation?: TagGitObservation;
}
export interface TagCreationView {
  operationId: string; name: string; sourceCommit: string; sourceTree: string;
  phase: TagCreationOperation["phase"]; createdAt: number; reason?: TagCreationOperation["reason"];
  observation?: TagGitObservation;
  cleanup: "not_reported";
}
const observationSchema = z.object({ object: z.string().regex(/^[a-f0-9]{40}$/), commit: z.string().regex(/^[a-f0-9]{40}$/).optional(), tree: z.string().regex(/^[a-f0-9]{40}$/).optional(), type: z.enum(["commit", "tag"]).optional() }).strict();
/** Intent and raw ref receipts only. Native lifetime/credential cleanup remains a
 * separate caller-owned ledger; neither tag confirmation nor absence proves stop.
 */
export class TagCreationOperations {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS tag_creation_operations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,incarnation TEXT NOT NULL,repo_name TEXT NOT NULL,tag_name TEXT NOT NULL,payload TEXT NOT NULL,doc TEXT NOT NULL,UNIQUE(project_id,incarnation,repo_name,tag_name))");
  }
  get(id: string): TagCreationOperation | null {
    z.uuid().parse(id);
    const row = this.storage.sql.exec<{doc:string}>("SELECT doc FROM tag_creation_operations WHERE id=?", id).toArray()[0];
    return row ? JSON.parse(row.doc) as TagCreationOperation : null;
  }
  prepare(input: TagCreationIdentity, validate: () => void, now = Date.now()): TagCreationOperation {
    const identity = tagCreationSchema.parse(input);
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid tag operation clock");
    return this.storage.transactionSync(() => {
      validate();
      const row = this.storage.sql.exec<{payload:string;doc:string}>("SELECT payload,doc FROM tag_creation_operations WHERE id=?", identity.operationId).toArray()[0], payload = JSON.stringify(identity);
      if (row) { if (row.payload !== payload) throw new Error("Tag operation identity changed"); return JSON.parse(row.doc) as TagCreationOperation; }
      if (this.storage.sql.exec("SELECT 1 FROM tag_creation_operations WHERE project_id=? AND incarnation=? AND repo_name=? AND tag_name=?", identity.projectId, identity.incarnation, identity.canonicalRepoName, identity.tag).toArray().length) throw new Error("Tag name already belongs to a saved operation");
      if (this.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM tag_creation_operations").one().n >= 10000) throw new Error("Tag audit capacity reached; prior operations remain preserved");
      const operation: TagCreationOperation = { ...identity, phase: "prepared", createdAt: now };
      this.storage.sql.exec("INSERT INTO tag_creation_operations VALUES(?,?,?,?,?,?,?)", identity.operationId, identity.projectId, identity.incarnation, identity.canonicalRepoName, identity.tag, payload, JSON.stringify(operation));
      return operation;
    });
  }
  private update(identity: TagCreationIdentity, validate: () => void, mutate: (operation: TagCreationOperation) => void): TagCreationOperation {
    const parsed = tagCreationSchema.parse(identity), payload = JSON.stringify(parsed);
    return this.storage.transactionSync(() => {
      validate();
      const row = this.storage.sql.exec<{payload:string;doc:string}>("SELECT payload,doc FROM tag_creation_operations WHERE id=?", parsed.operationId).toArray()[0];
      if (!row || row.payload !== payload) throw new Error("Exact saved tag identity required");
      const operation = JSON.parse(row.doc) as TagCreationOperation;
      mutate(operation);
      this.storage.sql.exec("UPDATE tag_creation_operations SET doc=? WHERE id=?", JSON.stringify(operation), parsed.operationId);
      return operation;
    });
  }
  claimNative(identity:TagCreationIdentity,input:TagNativeOwnership,validate:()=>void):boolean {
    const ownership=tagNativeOwnershipSchema.parse(input);let claimed=false;
    this.update(identity,validate,operation=>{if(operation.phase!=="prepared")throw Error("Tag native operation is unavailable");if(operation.native){if(operation.native.attemptId!==ownership.attemptId||operation.native.nativeId!==ownership.nativeId)throw Error("Tag native ownership differs");return;}operation.native={...ownership,stopped:false};claimed=true;});return claimed;
  }
  confirmNativeStopped(identity:TagCreationIdentity,input:TagNativeOwnership,proof:{name:string;sealed:true;stopped:true}):void {
    const ownership=tagNativeOwnershipSchema.parse(input);this.update(identity,()=>{},operation=>{if(!operation.native||operation.native.attemptId!==ownership.attemptId||operation.native.nativeId!==ownership.nativeId||proof.name!==`tag-${ownership.nativeId}`||proof.sealed!==true||proof.stopped!==true)throw Error("Tag native closure proof differs");operation.native.stopped=true;});
  }
  markDispatch(identity: TagCreationIdentity, input:TagNativeOwnership, validate: () => void):boolean {
    const ownership=tagNativeOwnershipSchema.parse(input);let dispatched=false;
    this.update(identity,validate,operation=>{if(!operation.native||operation.native.attemptId!==ownership.attemptId||operation.native.nativeId!==ownership.nativeId)throw Error("Exact tag native ownership required");if(operation.phase==="unknown"||operation.native.stopped)return;if(operation.phase!=="prepared")throw Error("Tag operation is terminal");operation.phase="unknown";dispatched=true;});return dispatched;
  }
  observe(identity: TagCreationIdentity, input: TagGitObservation | null, validate: () => void): TagCreationOperation {
    const observation = input === null ? null : observationSchema.parse(input);
    return this.update(identity, validate, operation => {
      if (operation.phase === "confirmed" || operation.phase === "refused") {
        if (JSON.stringify(operation.observation ?? null) !== JSON.stringify(observation)) throw new Error("Terminal tag observation changed");
        return;
      }
      if (!observation) return; // Absence is never retry permission after uncertain dispatch.
      operation.observation = observation;
      const exact = observation.object === identity.sourceCommit && observation.commit === identity.sourceCommit && observation.tree === identity.sourceTree && observation.type === "commit";
      if (operation.phase === "unknown" && exact) operation.phase = "confirmed";
      else { operation.phase = "refused"; operation.reason = exact ? "existing_ref" : "different_ref"; }
    });
  }
  abandon(identity: TagCreationIdentity, validate: () => void): TagCreationOperation {
    return this.update(identity, validate, operation => {
      if (operation.phase === "refused" && operation.reason === "owner_abandoned_prepared") return;
      if (operation.phase !== "prepared") throw new Error("Only undispatched prepared tags can be abandoned");
      operation.phase = "refused"; operation.reason = "owner_abandoned_prepared";
    });
  }
  view(operation: TagCreationOperation): TagCreationView {
    return { operationId: operation.operationId, name: operation.tag, sourceCommit: operation.sourceCommit, sourceTree: operation.sourceTree, phase: operation.phase, createdAt: operation.createdAt, ...(operation.reason ? { reason: operation.reason } : {}), ...(operation.observation ? { observation: operation.observation } : {}), cleanup: "not_reported" };
  }
}
