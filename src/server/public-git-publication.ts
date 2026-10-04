import { z } from "zod";
import { validatePublicGitConsent, type PublicGitConsentScope } from "./public-git-consent";

export interface PublicGitPublication extends PublicGitConsentScope {
  enabled: boolean;
  version: number;
  ownerId: string;
  decidedAt: string;
}
const mutation = z.object({ idempotencyKey: z.string().uuid(), expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();

/** Dormant ledger only. A trusted handler must authenticate an actual owner before invoking it. */
export class PublicGitPublicationLedger {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec("CREATE TABLE IF NOT EXISTS public_git_publication(id INTEGER PRIMARY KEY CHECK(id=1),doc TEXT NOT NULL); CREATE TABLE IF NOT EXISTS public_git_publication_receipts(event_key TEXT PRIMARY KEY,payload TEXT NOT NULL,doc TEXT NOT NULL)");
  }
  state(): PublicGitPublication | null {
    const row = this.storage.sql.exec<{ doc: string }>("SELECT doc FROM public_git_publication WHERE id=1").toArray()[0];
    return row ? JSON.parse(row.doc) as PublicGitPublication : null;
  }
  decide(input: { enabled: boolean; consent?: unknown; mutation: unknown }, current: Readonly<PublicGitConsentScope>, ownerId: string): PublicGitPublication {
    if (!ownerId || typeof input.enabled !== "boolean") throw new Error("Authenticated owner and explicit publication decision required");
    const request = mutation.parse(input.mutation);
    const consent = input.enabled ? validatePublicGitConsent(input.consent, current) : null;
    const payload = JSON.stringify({ enabled: input.enabled, consent, current, ownerId, expectedVersion: request.expectedVersion });
    return this.storage.transactionSync(() => {
      const previous = this.storage.sql.exec<{ payload: string; doc: string }>("SELECT payload,doc FROM public_git_publication_receipts WHERE event_key=?", request.idempotencyKey).toArray()[0];
      if (previous) {
        if (previous.payload !== payload) throw new Error("Git publication retry identity changed");
        return JSON.parse(previous.doc) as PublicGitPublication;
      }
      const version = this.state()?.version ?? 0;
      if (request.expectedVersion !== version) throw new Error("Git publication decision changed; reload before deciding");
      const decision: PublicGitPublication = { ...current, enabled: input.enabled, version: version + 1, ownerId, decidedAt: new Date().toISOString() };
      const doc = JSON.stringify(decision);
      this.storage.sql.exec("INSERT INTO public_git_publication_receipts VALUES(?,?,?)", request.idempotencyKey, payload, doc);
      this.storage.sql.exec("INSERT INTO public_git_publication VALUES(1,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc", doc);
      return decision;
    });
  }
  readable(current: Readonly<PublicGitConsentScope>): boolean {
    const saved = this.state();
    return !!saved?.enabled && saved.incarnation === current.incarnation && saved.commit === current.commit && saved.tree === current.tree && saved.publicationVersion === current.publicationVersion;
  }
}
