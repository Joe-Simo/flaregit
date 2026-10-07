import {z} from 'zod';
import type {CandidateGeneration, PublicationJournalEntry} from '../core/types';
import {runtimeRelease, type RuntimeReleaseEnvironment} from './runtime-release';
const sha = z.string().regex(/^[a-f0-9]{40}$/), time = z.number().int().nonnegative().safe();
export const nativePublicationCheckpointGrantSchema = z.object({
  caseId: z.uuid(), projectId: z.string().regex(/^[a-z0-9]{12,16}$/), incarnation: z.uuid(),
  workflowId: z.string().min(1).max(200), candidateId: z.string().min(1).max(128), journalId: z.string().min(1).max(128),
  commit: sha, tree: sha, ref: z.string().regex(/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9_/-]*$/).refine(value => !value.includes('..') && !value.includes('//') && !value.endsWith('/')),
  actorId: z.string().min(1).max(256), sourceVersion: sha,
  acceptedCommit: sha.nullable(), acceptedVersion: z.number().int().nonnegative().safe(), policyVersion: z.number().int().positive().safe(),
  activatedAt: time, expiresAt: time,
}).strict().refine(value => value.expiresAt > value.activatedAt && value.expiresAt - value.activatedAt <= 2700000);
export interface NativePublicationCheckpointEnvironment extends RuntimeReleaseEnvironment {
  C03_PRIVATE_MATRIX_ENABLED?: string;
  C03_PUBLICATION_CHECKPOINT_GRANT_JSON?: string;
  C03_PUBLICATION_CHECKPOINT_GRANTS_JSON?: string;
  C03_PUBLICATION_CHECKPOINT?: Pick<Fetcher, 'fetch'>;
}
export const nativePublicationCheckpointBatchSchema=z.array(nativePublicationCheckpointGrantSchema).min(1).max(2).superRefine((rows,ctx)=>{for(const key of ['caseId','candidateId','journalId','workflowId'] as const)if(new Set(rows.map(row=>row[key])).size!==rows.length)ctx.addIssue({code:'custom',message:'Distinct private checkpoint identities required'});for(const row of rows)for(const key of ['projectId','incarnation','actorId','sourceVersion','acceptedCommit','acceptedVersion','policyVersion','ref'] as const)if(row[key]!==rows[0]![key])ctx.addIssue({code:'custom',message:'One frozen private race basis required'});});
export function selectNativePublicationCheckpointGrant(env:NativePublicationCheckpointEnvironment,input:{workflowId:string;candidate:CandidateGeneration;journal:PublicationJournalEntry}){
 if(env.C03_PUBLICATION_CHECKPOINT_GRANTS_JSON){if(env.C03_PUBLICATION_CHECKPOINT_GRANT_JSON&&env.C03_PUBLICATION_CHECKPOINT_GRANT_JSON!=='null')throw Error('Ambiguous checkpoint grants');if(env.C03_PUBLICATION_CHECKPOINT_GRANTS_JSON.length>16384)throw Error('Checkpoint grant bound');const rows=nativePublicationCheckpointBatchSchema.parse(JSON.parse(env.C03_PUBLICATION_CHECKPOINT_GRANTS_JSON)),matches=rows.filter(row=>row.workflowId===input.workflowId&&row.candidateId===input.candidate.id&&row.journalId===input.journal.id);if(matches.length!==1)throw Error('Exact checkpoint case required');return matches[0]!;}
 return nativePublicationCheckpointGrantSchema.parse(JSON.parse(env.C03_PUBLICATION_CHECKPOINT_GRANT_JSON??'null'));
}
/** Internal server binding only; no request supplies a pause, grant or actor.
 * A reached callback records publisher position, never acceptance by itself. */
export async function nativePublicationCheckpoint(env: NativePublicationCheckpointEnvironment, input: {point: 'before-ref-update' | 'after-ref-update'; projectId: string; workflowId: string; candidate: CandidateGeneration; journal: PublicationJournalEntry; commit: string; ref: string}): Promise<'continue' | 'held'> {
  if (env.C03_PRIVATE_MATRIX_ENABLED !== 'true') return 'continue';
  if (!input.candidate.acceptedTarget) return 'continue'; // Never fault the unbound legacy abort path.
  if ((!env.C03_PUBLICATION_CHECKPOINT_GRANT_JSON&&!env.C03_PUBLICATION_CHECKPOINT_GRANTS_JSON) || !env.C03_PUBLICATION_CHECKPOINT) return 'held';
  try {
    const grant = selectNativePublicationCheckpointGrant(env,input);
    const exact = () => {
      const now = Date.now(), release = runtimeRelease(env), target = input.candidate.acceptedTarget;
      if (input.candidate.expectedAcceptedBase !== grant.acceptedCommit || input.candidate.frozenPolicyVersion !== grant.policyVersion || input.journal.publicationAuthority?.commit !== grant.commit || input.journal.publicationAuthority.tree !== grant.tree) throw Error('Original accepted/review basis differs');
      if (env.C03_PRIVATE_MATRIX_ENABLED !== 'true' || !env.C03_PUBLICATION_CHECKPOINT || !release.releaseIdentified || release.sourceVersion !== grant.sourceVersion || now < grant.activatedAt || now >= grant.expiresAt || input.projectId !== grant.projectId || input.workflowId !== grant.workflowId || input.candidate.id !== grant.candidateId || input.candidate.candidateCommit !== grant.commit || input.commit !== grant.commit || input.ref !== grant.ref || target?.incarnation !== grant.incarnation || target.ref !== grant.ref || target.acceptedCommit !== grant.acceptedCommit || target.acceptedVersion !== grant.acceptedVersion || target.policyVersion !== grant.policyVersion || input.journal.id !== grant.journalId || input.journal.candidateTree !== grant.tree || input.journal.newHead !== grant.commit || input.journal.state !== 'PREPARED' || input.journal.publicationAuthority?.kind !== 'human-review' || input.journal.publicationAuthority.actor.userId !== grant.actorId || input.journal.publicationAuthority.actor.viaToken || input.candidate.review?.actor?.userId !== grant.actorId || input.candidate.review.actor.viaToken || !input.candidate.review.approved || input.candidate.review.commit !== grant.commit) throw Error('Private original checkpoint grant unavailable');
    };
    exact();
    const workerVersion = runtimeRelease(env).workerVersion;
    const deadline = Date.now() + 10000;
    const bounded = async <T>(work: Promise<T>) => {let timer: ReturnType<typeof setTimeout> | undefined; try {return await Promise.race([work, new Promise<never>((_, reject) => {timer = setTimeout(() => reject(Error('Checkpoint callback deadline')), Math.max(1, deadline - Date.now()));})]);} finally {clearTimeout(timer);}};
    const response = await bounded(env.C03_PUBLICATION_CHECKPOINT!.fetch(new Request('https://c03-publication-checkpoint.invalid/reached', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({grant, workerVersion, point: input.point}), signal: AbortSignal.timeout(10000)})));
    exact();
    if (!response.ok || Number(response.headers.get('Content-Length') ?? 0) > 1024) return 'held';
    const reader = response.body?.getReader(); if (!reader) return 'held';
    const chunks: Uint8Array[] = []; let size = 0;
    try {for (;;) {const part = await bounded(reader.read()); if (part.done) break; size += part.value.length; if (size > 1024) throw Error('Checkpoint response bound'); chunks.push(part.value);}}
    finally {void reader.cancel().catch(() => {}); reader.releaseLock();}
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    // The private service registers this actual deployed UUID after upload. It
    // must validate it against its stored case; the env grant never guesses it.
    const reply = z.object({caseId: z.literal(grant.caseId), journalId: z.literal(grant.journalId), workerVersion: z.literal(workerVersion), point: z.literal(input.point), action: z.enum(['continue', 'hold'])}).strict().parse(JSON.parse(text));
    exact(); return reply.action === 'continue' ? 'continue' : 'held';
  } catch {return 'held';}
}
/** Surrounds the actual dispatch. All production authorization remains inside
 * dispatch; nothing is awaited between its final authorizer and the Git CAS. */
export async function checkpointedNativeRefUpdate<T extends {success: boolean}>(env: NativePublicationCheckpointEnvironment, input: Omit<Parameters<typeof nativePublicationCheckpoint>[1], 'point'>, dispatch: () => Promise<T>): Promise<{kind: 'held-before'} | {kind: 'held-after'; result: T} | {kind: 'result'; result: T}> {
  if (await nativePublicationCheckpoint(env, {...input, point: 'before-ref-update'}) === 'held') return {kind: 'held-before'};
  const result = await dispatch();
  if (result.success && await nativePublicationCheckpoint(env, {...input, point: 'after-ref-update'}) === 'held') return {kind: 'held-after', result};
  return {kind: 'result', result};
}
