import {DurableObject, WorkerEntrypoint} from 'cloudflare:workers';
import {z} from 'zod';
import {nativePublicationCheckpointGrantSchema} from '../../src/server/c03-native-publication-checkpoint';
type Grant = z.infer<typeof nativePublicationCheckpointGrantSchema>;
const point = z.enum(['before-ref-update', 'after-ref-update']);
const callback = z.object({grant: nativePublicationCheckpointGrantSchema, workerVersion: z.uuid(), point}).strict();
interface Env {CASES: DurableObjectNamespace<PrivateCheckpointCase>; C03_CASE_PROJECT_ID: string; C03_CASE_ACTOR_ID: string}
interface Row {grant: Grant; workerVersion: string; pauseAt: z.infer<typeof point>; phase: 'registered' | 'held' | 'resumed'; reached: Array<z.infer<typeof point>>; resumeId: string | null}
/** Private orchestration metadata only. Root registers the ACTUAL deployed UUID
 * after core upload. No token/native/Git capability exists in this Worker. */
export class PrivateCheckpointCase extends DurableObject<Env> {
  private identity(caseId:string){if(this.env.CASES.idFromName('case-'+caseId).toString()!==this.ctx.id.toString())throw Error('Original case namespace required');}
  private read(): Row | null {this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS checkpoint_case(id INTEGER PRIMARY KEY CHECK(id=1),doc TEXT NOT NULL)'); const row = this.ctx.storage.sql.exec<{doc: string}>('SELECT doc FROM checkpoint_case WHERE id=1').toArray()[0]; return row ? JSON.parse(row.doc) as Row : null;}
  private save(row: Row) {this.ctx.storage.sql.exec('INSERT INTO checkpoint_case VALUES(1,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc', JSON.stringify(row));}
  register(grant: Grant, workerVersion: string, pauseAt: z.infer<typeof point>) {
    grant = nativePublicationCheckpointGrantSchema.parse(grant); this.identity(grant.caseId); z.uuid().parse(workerVersion); point.parse(pauseAt);
    if (grant.projectId !== this.env.C03_CASE_PROJECT_ID || grant.actorId !== this.env.C03_CASE_ACTOR_ID || Date.now() < grant.activatedAt || Date.now() >= grant.expiresAt) throw Error('Exact authorized private case required');
    return this.ctx.storage.transactionSync(() => {const old = this.read(), row: Row = {grant, workerVersion, pauseAt, phase: 'registered', reached: [], resumeId: null}; if (old) {if (JSON.stringify(old.grant) !== JSON.stringify(grant) || old.workerVersion !== workerVersion || old.pauseAt !== pauseAt) throw Error('Immutable case differs'); return old;} this.save(row); return row;});
  }
  reached(input: z.infer<typeof callback>) {
    input = callback.parse(input); this.identity(input.grant.caseId);
    return this.ctx.storage.transactionSync(() => {const row = this.read(); if (!row || JSON.stringify(row.grant) !== JSON.stringify(input.grant) || row.workerVersion !== input.workerVersion || Date.now() < row.grant.activatedAt || Date.now() >= row.grant.expiresAt) throw Error('Original live registered case required'); if (input.point === 'after-ref-update' && !row.reached.includes('before-ref-update')) throw Error('Callback order differs'); if (!row.reached.includes(input.point)) row.reached.push(input.point); if (input.point === row.pauseAt && row.resumeId === null) row.phase = 'held'; this.save(row); return {caseId: row.grant.caseId, journalId: row.grant.journalId, workerVersion: row.workerVersion, point: input.point, action: row.phase === 'held' ? 'hold' as const : 'continue' as const};});
  }
  resume(grant: Grant, resumeId: string) {z.uuid().parse(resumeId); return this.ctx.storage.transactionSync(() => {const row = this.read(); if (!row || JSON.stringify(row.grant) !== JSON.stringify(grant) || Date.now() >= row.grant.expiresAt) throw Error('Original live case required'); if (row.resumeId) {if (row.resumeId !== resumeId) throw Error('Original resume ID required'); return row;} if (row.phase !== 'held') throw Error('Reached held case required'); row.resumeId = resumeId; row.phase = 'resumed'; this.save(row); return row;});}
  status() {return this.read();}
}
/** Service-binding entrypoint, never the public default fetch. */
export class NativeCheckpointReceiver extends WorkerEntrypoint<Env> {
  override async fetch(request: Request) {
    try {if (request.method !== 'POST' || request.url !== 'https://c03-publication-checkpoint.invalid/reached' || request.headers.get('Content-Type') !== 'application/json') return new Response('Refused', {status: 403}); const reader = request.body?.getReader(); if (!reader) return new Response('Refused', {status: 400}); const chunks: Uint8Array[] = []; let size = 0; const deadline = Date.now() + 5000; try {for (;;) {let timer: ReturnType<typeof setTimeout> | undefined; const part = await (async () => {try {return await Promise.race([reader.read(), new Promise<never>((_, reject) => {timer = setTimeout(() => reject(Error('Body deadline')), Math.max(1, deadline - Date.now()));})]);} finally {clearTimeout(timer);}})(); if (part.done) break; size += part.value.length; if (size > 4096 || Date.now() >= deadline) throw Error('Body bound'); chunks.push(part.value);}} finally {void reader.cancel().catch(() => {}); reader.releaseLock();} const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;} const input = callback.parse(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes))); return Response.json(await this.env.CASES.getByName('case-' + input.grant.caseId).reached(input), {headers: {'Cache-Control': 'no-store'}});} catch {return new Response('Original checkpoint unconfirmed', {status: 409, headers: {'Cache-Control': 'no-store'}});}
  }
}
/** Root-only RPC binding held by a trusted operator, not the contributor app. */
export class NativeCheckpointOperator extends WorkerEntrypoint<Env> {
  register(grant: Grant, actualWorkerVersion: string, pauseAt: z.infer<typeof point>) {return this.env.CASES.getByName('case-' + nativePublicationCheckpointGrantSchema.parse(grant).caseId).register(grant, actualWorkerVersion, pauseAt);}
  resume(grant: Grant, originalResumeId: string) {return this.env.CASES.getByName('case-' + grant.caseId).resume(grant, originalResumeId);}
  status(caseId: string) {return this.env.CASES.getByName('case-' + z.uuid().parse(caseId)).status();}
}
export default {fetch: () => new Response('No public checkpoint API', {status: 404})};
