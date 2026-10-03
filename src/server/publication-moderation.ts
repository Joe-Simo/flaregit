import { z } from "zod";
export type PublicationModerationKind = "profile" | "repository";
export interface PublicationModerationState { suppressed: boolean; version: number; reason: string | null; reportId: string | null; operatorAccountKey: string | null; decidedAt: string | null }
export interface PublicationModerationDecision extends PublicationModerationState { id: string; kind: PublicationModerationKind; targetId: string; action: "suppress" | "lift"; idempotencyKey: string }
export const publicationModerationInput = z.object({ action: z.enum(["suppress", "lift"]), confirmed: z.literal(true), reason: z.string().trim().min(1).max(2000), reportId: z.string().min(1).max(200), expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), idempotencyKey: z.string().min(8).max(200) }).strict();
export class PublicationModeration {
  constructor(private storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS publication_moderation_state(kind TEXT NOT NULL,target_id TEXT NOT NULL,doc TEXT NOT NULL,PRIMARY KEY(kind,target_id)); CREATE TABLE IF NOT EXISTS publication_moderation_decisions(id TEXT PRIMARY KEY,kind TEXT NOT NULL,target_id TEXT NOT NULL,event_key TEXT NOT NULL,payload TEXT NOT NULL,doc TEXT NOT NULL,UNIQUE(kind,target_id,event_key));");
  }
  state(kind: PublicationModerationKind, targetId: string): PublicationModerationState {
    const row = this.storage.sql.exec<{doc:string}>("SELECT doc FROM publication_moderation_state WHERE kind=? AND target_id=?",kind,targetId).toArray()[0];
    return row ? JSON.parse(row.doc) as PublicationModerationState : {suppressed:false,version:0,reason:null,reportId:null,operatorAccountKey:null,decidedAt:null};
  }
  history(kind: PublicationModerationKind, targetId: string): PublicationModerationDecision[] {
    return this.storage.sql.exec<{doc:string}>("SELECT doc FROM publication_moderation_decisions WHERE kind=? AND target_id=? ORDER BY json_extract(doc,'$.version') DESC",kind,targetId).toArray().map(row=>JSON.parse(row.doc) as PublicationModerationDecision);
  }
  moderate(kind: PublicationModerationKind, targetId: string, value: unknown, operatorAccountKey: string, onDecision:()=>void): PublicationModerationDecision {
    const input=publicationModerationInput.parse(value);
    if (!targetId || !operatorAccountKey) throw new Error("Canonical target and operator identity required");
    const payload=JSON.stringify({...input,operatorAccountKey});
    return this.storage.transactionSync(()=>{
      const receipt=this.storage.sql.exec<{payload:string;doc:string}>("SELECT payload,doc FROM publication_moderation_decisions WHERE kind=? AND target_id=? AND event_key=?",kind,targetId,input.idempotencyKey).toArray()[0];
      if(receipt){if(receipt.payload!==payload)throw new Error("Moderation idempotency conflict");return JSON.parse(receipt.doc) as PublicationModerationDecision;}
      const current=this.state(kind,targetId);
      if(current.version!==input.expectedVersion)throw new Error("Moderation version conflict; refresh before deciding");
      const decision:PublicationModerationDecision={id:crypto.randomUUID(),kind,targetId,action:input.action,idempotencyKey:input.idempotencyKey,suppressed:input.action==="suppress",version:current.version+1,reason:input.reason,reportId:input.reportId,operatorAccountKey,decidedAt:new Date().toISOString()};
      const doc=JSON.stringify(decision);
      this.storage.sql.exec("INSERT INTO publication_moderation_decisions VALUES(?,?,?,?,?,?)",decision.id,kind,targetId,input.idempotencyKey,payload,doc);
      this.storage.sql.exec("INSERT INTO publication_moderation_state VALUES(?,?,?) ON CONFLICT(kind,target_id) DO UPDATE SET doc=excluded.doc",kind,targetId,doc);
      onDecision();
      return decision;
    });
  }
}
