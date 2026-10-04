import { z } from 'zod';
import { isSafeRef } from '../core/sanitize';
import { InitialArtifactCredentials } from './initial-artifact-credentials';
const identifier = z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
const branch = z.string().min(1).max(200).refine(value => value !== 'HEAD' && !value.startsWith('refs/') && isSafeRef(value));
const commit = z.string().regex(/^[a-f0-9]{40}$/).refine(value => !/^0{40}$/.test(value));
const initializationBaseSchema = z.object({
  requestId: z.uuid(), eventId: z.uuid(), allocationId: z.uuid(), projectId: identifier, incarnation: z.uuid(), canonicalRepoName: identifier,
  accountKey: identifier, actorId: z.string().min(1).max(256).regex(/^[^\x00-\x1f\x7f]+$/),
  name: z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9._ -]+$/), description: z.string().max(300).refine(value => !/[\x00-\x1f\x7f]/.test(value)), defaultBranch: branch,
});
const readmeScopeSchema=initializationBaseSchema.extend({initialization:z.literal("readme").optional(),readme:z.string().min(1).max(16384),authorName:z.string().min(1).max(200).refine(value=>!/[\x00-\x1f\x7f]/.test(value)),authorEmail:z.string().min(3).max(254).regex(/^[^\s<>@]+@[^\s<>@]+$/),commitTimestamp:z.string().datetime({offset:true})}).strict();
const emptyScopeSchema=initializationBaseSchema.extend({initialization:z.literal("empty"),readme:z.null(),authorName:z.null(),authorEmail:z.null(),commitTimestamp:z.null()}).strict();
export const repositoryInitializationScopeSchema=z.union([readmeScopeSchema,emptyScopeSchema]);
export type ReadmeRepositoryInitializationScope=z.infer<typeof readmeScopeSchema>;
export type EmptyRepositoryInitializationScope=z.infer<typeof emptyScopeSchema>;
export type RepositoryInitializationScope = z.infer<typeof repositoryInitializationScopeSchema>;
const credentialScopeSchema = initializationBaseSchema.pick({ eventId: true, allocationId: true, projectId: true, incarnation: true, canonicalRepoName: true, accountKey: true, actorId: true });
export type InitialRepositoryCredentialScope = z.infer<typeof credentialScopeSchema>;
export class InitialRepositoryCredentials extends InitialArtifactCredentials<InitialRepositoryCredentialScope> {
  constructor(storage: DurableObjectStorage) { super(storage, { table: 'initial_repository_credentials', parse: value => credentialScopeSchema.parse(value), repositoryName: scope => scope.canonicalRepoName }); }
}
export class InitialRepositoryReadCredentials extends InitialArtifactCredentials<InitialRepositoryCredentialScope> {
  constructor(storage:DurableObjectStorage){super(storage,{table:'initial_repository_read_credentials',parse:value=>credentialScopeSchema.parse(value),repositoryName:scope=>scope.canonicalRepoName});}
}
export interface InitialRepositoryMetadata { id: string; name: string; remote: string; defaultBranch?:string }
export interface RepositoryEmptyProof {repositoryId:string;canonicalRepoName:string;defaultRef:string;refs:[];symbolicHead:string|null}
export interface RepositoryInitialCommit { head: string; tree: string; defaultBranch: string }
export interface RepositoryInitializationIntent {
  scope: RepositoryInitializationScope;
  phase: 'prepared' | 'create_possible' | 'created' | 'native_possible' | 'publication_prepared' | 'publication_possible' | 'empty_verified' | 'ready';
  metadata?: InitialRepositoryMetadata;
  nativeName?: string;
  nativeStopped?: true;
  commit?: RepositoryInitialCommit;
  published?: true;
  emptyProof?:RepositoryEmptyProof;
}
const metadataSchema = z.object({ id: identifier, name: identifier, remote: z.string().min(1).max(2048).refine(value => !/[\x00-\x20\x7f]/.test(value)) ,defaultBranch:branch.optional()}).strict();
const commitSchema = z.object({ head: commit, tree: commit, defaultBranch: branch }).strict();
const credentialScope = (scope: RepositoryInitializationScope) => credentialScopeSchema.parse({ eventId: scope.eventId, allocationId: scope.allocationId, projectId: scope.projectId, incarnation: scope.incarnation, canonicalRepoName: scope.canonicalRepoName, accountKey: scope.accountKey, actorId: scope.actorId });
/** Only receipt-backed initialization can become ready. Provider/native ambiguity
 * remains a saved operation; neither a name lookup nor elapsed time retries creation.
 * Failed operations never delete repositories or manufacture accepted Git history.
 */
export class RepositoryInitializationIntents {
  readonly credentials: InitialRepositoryCredentials;
  readonly readCredentials:InitialRepositoryReadCredentials;
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS repository_initialization_intents(event_id TEXT PRIMARY KEY,payload TEXT NOT NULL,doc TEXT NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS repository_initialization_requests(actor_id TEXT NOT NULL,request_id TEXT NOT NULL,event_id TEXT UNIQUE NOT NULL,PRIMARY KEY(actor_id,request_id))');
    this.credentials = new InitialRepositoryCredentials(storage);
    this.readCredentials = new InitialRepositoryReadCredentials(storage);
  }
  get(eventId: string): RepositoryInitializationIntent | null { z.uuid().parse(eventId); const row = this.storage.sql.exec<{ doc: string }>('SELECT doc FROM repository_initialization_intents WHERE event_id=?', eventId).toArray()[0]; return row ? JSON.parse(row.doc) as RepositoryInitializationIntent : null; }
  getByRequest(requestId: string, actorId: string): RepositoryInitializationIntent | null { z.uuid().parse(requestId); initializationBaseSchema.shape.actorId.parse(actorId); const row = this.storage.sql.exec<{ event_id: string }>('SELECT event_id FROM repository_initialization_requests WHERE actor_id=? AND request_id=?', actorId, requestId).toArray()[0]; return row ? this.get(row.event_id) : null; }
  private save(record: RepositoryInitializationIntent) { this.storage.sql.exec('UPDATE repository_initialization_intents SET doc=? WHERE event_id=?', JSON.stringify(record), record.scope.eventId); }
  prepare(input: RepositoryInitializationScope, validate: () => void): RepositoryInitializationIntent {
    const scope = repositoryInitializationScopeSchema.parse(input), payload = JSON.stringify(scope);
    const readme = `# ${scope.name}\n${scope.description.trim() ? `\n${scope.description.trim()}\n` : ''}`;
    if (scope.initialization!=="empty" && scope.readme !== readme) throw Error('Repository initialization content differs from the explicit request');
    return this.storage.transactionSync(() => { validate(); const requested = this.getByRequest(scope.requestId, scope.actorId); if (requested && requested.scope.eventId !== scope.eventId) throw Error('Repository request identity changed; recover the original server event'); const old = this.get(scope.eventId); if (old) { if (JSON.stringify(old.scope) !== payload) throw Error('Repository creation identity changed'); return old; }
      if (this.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM repository_initialization_intents').toArray()[0]!.n >= 10000) throw Error('Repository initialization audit capacity reached; saved operations remain preserved');
      const record: RepositoryInitializationIntent = { scope, phase: 'prepared' }; this.storage.sql.exec('INSERT INTO repository_initialization_intents VALUES(?,?,?)', scope.eventId, payload, JSON.stringify(record)); this.storage.sql.exec('INSERT INTO repository_initialization_requests VALUES(?,?,?)', scope.actorId, scope.requestId, scope.eventId); return record;
    });
  }
  beginCreate(eventId: string, validate: () => void): boolean {
    return this.storage.transactionSync(() => { validate(); const record = this.get(eventId); if (!record) throw Error('Saved repository creation required'); if (record.phase !== 'prepared') return false;
      this.credentials.begin(credentialScope(record.scope), validate); record.phase = 'create_possible'; this.save(record); return true;
    });
  }
  /** Known plaintext survives before any await, including a malformed metadata
   * response or authority withdrawal. Recording a fact never grants native use. */
  async recordCreated(eventId: string, metadata: InitialRepositoryMetadata, token: string): Promise<void> {
    const record = this.get(eventId); if (!record || record.phase === 'prepared') throw Error('Repository creation dispatch intent unavailable');
    const recording = this.credentials.record(credentialScope(record.scope), token);
    let failure: unknown;
    try { const parsed = metadataSchema.parse(metadata); this.storage.transactionSync(() => { const current = this.get(eventId)!; if (JSON.stringify(current.scope) !== JSON.stringify(record.scope) || parsed.name !== current.scope.canonicalRepoName || (current.metadata && JSON.stringify(current.metadata) !== JSON.stringify(parsed))) throw Error('Repository creation receipt differs from its exact intent'); current.metadata = parsed; if (current.phase === 'create_possible') current.phase = 'created'; this.save(current); }); } catch (error) { failure = error; }
    await recording; if (failure) throw failure;
  }
  beginNative(eventId: string, nativeName: string, validate: () => void): boolean {
    return this.storage.transactionSync(() => { validate(); const record = this.get(eventId); if (!record?.metadata || nativeName !== `${record.scope.initialization==="empty"?"empty":"readme"}-${eventId}`) throw Error('Exact recorded repository/native identity required'); if (record.phase !== 'created') return false;
      if (!(record.scope.initialization==="empty"?this.credentials.settled(credentialScope(record.scope)):this.credentials.credentialForRevocation(eventId))) throw Error('Recorded initialization credential unavailable'); record.nativeName = nativeName; record.phase = 'native_possible'; this.save(record); return true;
    });
  }
  recordCommit(eventId: string, receipt: RepositoryInitialCommit): void {
    const parsed = commitSchema.parse(receipt);
    this.storage.transactionSync(() => { const record = this.get(eventId); if (!record?.metadata || record.scope.initialization==="empty" || !record.nativeName || !['native_possible','publication_prepared','publication_possible','ready'].includes(record.phase) || parsed.defaultBranch !== record.scope.defaultBranch || (record.commit && JSON.stringify(record.commit) !== JSON.stringify(parsed))) throw Error('Initial Git receipt has no exact native intent'); record.commit = parsed; if (record.phase === 'native_possible') record.phase = 'publication_prepared'; this.save(record); });
  }
  /** A possible push remains held even when its acknowledgement is lost. */
  beginPush(eventId: string, validate: () => void): boolean {
    return this.storage.transactionSync(() => { validate(); const record = this.get(eventId); if (!record?.commit || !record.nativeName || record.nativeStopped) throw Error('Exact active initial Git publication required'); if (record.phase !== 'publication_prepared') return false; record.phase = 'publication_possible'; this.save(record); return true; });
  }
  /** Only authoritative Git readback of the original persisted root may resolve
   * a lost push acknowledgement. This never dispatches or regenerates a commit. */
  confirmPublished(eventId: string, proof: RepositoryInitialCommit): void {
    const parsed = commitSchema.parse(proof);
    this.storage.transactionSync(() => { const record = this.get(eventId); if (!record?.commit || !['publication_possible','ready'].includes(record.phase) || JSON.stringify(record.commit) !== JSON.stringify(parsed)) throw Error('Initial publication readback differs from its original committed intent'); record.published = true; this.save(record); });
  }
  beginReadCredential(eventId:string,validate:()=>void):boolean{
    return this.storage.transactionSync(()=>{validate();const record=this.get(eventId);if(!record?.metadata||record.scope.initialization!=="empty"||record.phase!=="native_possible"||!record.nativeName||record.nativeStopped||!this.credentials.settled(credentialScope(record.scope)))throw Error("Exact empty read issuance scope unavailable");return this.readCredentials.begin(credentialScope(record.scope),validate);});
  }
  async recordReadCredential(eventId:string,token:string):Promise<void>{const record=this.get(eventId);if(!record||record.scope.initialization!=="empty")throw Error("Saved empty read credential scope required");await this.readCredentials.record(credentialScope(record.scope),token);}
  async confirmReadCredentialRevoked(eventId:string,token:string,proof:{repoName:string;revoked:boolean}):Promise<boolean>{const record=this.get(eventId);if(!record||record.scope.initialization!=="empty")throw Error("Saved empty read credential scope required");return this.readCredentials.markRevoked(credentialScope(record.scope),token,proof);}
  recordEmpty(eventId:string,proof:RepositoryEmptyProof):void{
    const ref=z.string().refine(value=>value.startsWith("refs/heads/")&&isSafeRef(value));
    const parsed=z.object({repositoryId:identifier,canonicalRepoName:identifier,defaultRef:ref,refs:z.tuple([]),symbolicHead:ref.nullable()}).strict().parse(proof);
    this.storage.transactionSync(()=>{const record=this.get(eventId);if(!record?.metadata||record.scope.initialization!=="empty"||!record.nativeName||record.nativeStopped||!this.readCredentials.credentialForRevocation(eventId)||!["native_possible","empty_verified"].includes(record.phase))throw Error("Active empty repository inspection required");
      if(parsed.repositoryId!==record.metadata.id||parsed.canonicalRepoName!==record.scope.canonicalRepoName||parsed.defaultRef!==`refs/heads/${record.scope.defaultBranch}`||(parsed.symbolicHead!==null&&parsed.symbolicHead!==parsed.defaultRef)||(parsed.symbolicHead===null&&record.metadata.defaultBranch!==record.scope.defaultBranch))throw Error("Empty repository/default HEAD proof differs from the recorded scope");
      if(record.emptyProof&&JSON.stringify(record.emptyProof)!==JSON.stringify(parsed))throw Error("Empty repository proof changed");record.emptyProof=parsed;record.phase="empty_verified";this.save(record);
    });
  }
  confirmNativeStopped(eventId: string, proof: { name: string; stopped: boolean; sealed: boolean }): boolean {
    return this.storage.transactionSync(() => { const record = this.get(eventId); if (!record?.nativeName || proof.name !== record.nativeName || proof.stopped !== true || proof.sealed !== true) return false; record.nativeStopped = true; this.save(record); return true; });
  }
  async confirmCredentialRevoked(eventId: string, token: string, proof: { repoName: string; revoked: boolean }): Promise<boolean> { const record = this.get(eventId); if (!record) throw Error('Saved repository credential scope required'); return this.credentials.markRevoked(credentialScope(record.scope), token, proof); }
  complete(eventId: string, validate: () => void): RepositoryInitializationIntent {
    return this.storage.transactionSync(() => { validate(); const record = this.get(eventId); if (!record?.metadata || (record.scope.initialization==="empty"?(!record.emptyProof||!this.readCredentials.settled(credentialScope(record.scope))):(!record.commit||record.published!==true)) || record.nativeStopped !== true || !this.credentials.settled(credentialScope(record.scope))) throw Error('Repository initialization or cleanup remains unconfirmed'); record.phase = 'ready'; this.save(record); return record; });
  }
}
