import {expect, test} from 'bun:test';
import {checkpointedNativeRefUpdate, nativePublicationCheckpoint, type NativePublicationCheckpointEnvironment} from '../src/server/c03-native-publication-checkpoint';
import type {CandidateGeneration, PublicationJournalEntry} from '../src/core/types';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const actor = {userId: 'synthetic-owner', displayName: 'Fixture', viaToken: false};
function fixture() {
  const now = Date.now(), commit = 'b'.repeat(40), tree = 'c'.repeat(40), incarnation = crypto.randomUUID(), workerVersion = crypto.randomUUID(), sourceVersion = 'd'.repeat(40);
  const candidate: CandidateGeneration = {id: 'candidate-fixture', attemptNumber: 1, participatingTaskIds: [], participatingCommits: {}, expectedAcceptedBase: 'a'.repeat(40), frozenPolicyVersion: 1, frozenVerificationPolicy: {}, frozenRequirements: [], candidateCommit: commit, repairAttempts: [], status: 'verified', createdAt: 'synthetic', updatedAt: 'synthetic', acceptedTarget: {projectId: 'p123456789abc', incarnation, canonicalRepoName: 'owned', ref: 'refs/heads/main', branch: 'main', acceptedCommit: 'a'.repeat(40), acceptedVersion: 17, policyVersion: 1, requirements: [], policy: {}}, review: {approved: true, commit, actor, by: 'Fixture', at: 'synthetic'}};
  const journal = {id: 'jrnl-fixture', candidateId: candidate.id, state: 'PREPARED', candidateTree: tree, newHead: commit, publicationAuthority: {kind: 'human-review', commit, tree, actor}} as PublicationJournalEntry;
  const grant = {caseId: crypto.randomUUID(), projectId: 'p123456789abc', incarnation, workflowId: 'original-workflow', candidateId: candidate.id, journalId: journal.id, commit, tree, ref: 'refs/heads/main', actorId: actor.userId, sourceVersion, acceptedCommit: candidate.acceptedTarget!.acceptedCommit, acceptedVersion: candidate.acceptedTarget!.acceptedVersion, policyVersion: candidate.acceptedTarget!.policyVersion, activatedAt: now - 1, expiresAt: now + 60000};
  const input = {projectId: grant.projectId, workflowId: grant.workflowId, candidate, journal, commit, ref: grant.ref};
  const env: NativePublicationCheckpointEnvironment = {CF_VERSION_METADATA: {id: workerVersion, tag: '', timestamp: ''}, FLAREGIT_SOURCE_VERSION: sourceVersion, C03_PRIVATE_MATRIX_ENABLED: 'true', C03_PUBLICATION_CHECKPOINT_GRANT_JSON: JSON.stringify(grant)};
  const response = (point: string, action: string) => Response.json({caseId: grant.caseId, journalId: grant.journalId, workerVersion, point, action});
  return {env, input, grant, response};
}
test('disabled publisher hook performs no callback and keeps actual dispatch authorization order', async () => {
  const f = fixture(), calls: string[] = []; delete f.env.C03_PRIVATE_MATRIX_ENABLED;
  f.env.C03_PUBLICATION_CHECKPOINT = {fetch: async () => {throw Error('Disabled hook must not call service');}};
  const result = await checkpointedNativeRefUpdate(f.env, f.input, async () => {calls.push('production-authorization'); calls.push('actual-ref-dispatch'); return {success: true};});
  expect(result.kind).toBe('result'); expect(calls).toEqual(['production-authorization', 'actual-ref-dispatch']);
  f.env.C03_PRIVATE_MATRIX_ENABLED='false'; delete f.env.C03_PUBLICATION_CHECKPOINT_GRANT_JSON;
  expect(await nativePublicationCheckpoint(f.env,{...f.input,point:'before-ref-update'})).toBe('continue');
  f.env.C03_PRIVATE_MATRIX_ENABLED='true'; delete f.env.C03_PUBLICATION_CHECKPOINT;
  expect(await nativePublicationCheckpoint(f.env,{...f.input,point:'before-ref-update'})).toBe('held');
});
test('private exact before/after hooks surround real dispatch without entering final authorization window', async () => {
  const f = fixture(), calls: string[] = [];
  f.env.C03_PUBLICATION_CHECKPOINT = {fetch: async request => {const body = await (request as Request).json() as {point: string}; calls.push(body.point); return f.response(body.point, body.point === 'after-ref-update' ? 'hold' : 'continue');}};
  const result = await checkpointedNativeRefUpdate(f.env, f.input, async () => {calls.push('final-production-authorization'); calls.push('actual-ref-dispatch'); return {success: true};});
  expect(result.kind).toBe('held-after'); expect(calls).toEqual(['before-ref-update', 'final-production-authorization', 'actual-ref-dispatch', 'after-ref-update']); expect(f.input.journal.state).toBe('PREPARED');
});
test('wrong owner/tuple, expired grant and unknown callback hold before writes; legacy path is untouched', async () => {
  const f = fixture(); let dispatches = 0, callbacks = 0;
  f.env.C03_PUBLICATION_CHECKPOINT = {fetch: async () => {callbacks++; return new Response('unknown', {status: 503});}};
  expect(await nativePublicationCheckpoint(f.env, {...f.input, point: 'before-ref-update', commit: 'e'.repeat(40)})).toBe('held'); expect(callbacks).toBe(0);
  f.env.C03_PUBLICATION_CHECKPOINT_GRANT_JSON = JSON.stringify({...f.grant, expiresAt: Date.now() - 1});
  expect((await checkpointedNativeRefUpdate(f.env, f.input, async () => {dispatches++; return {success: true};})).kind).toBe('held-before'); expect(dispatches).toBe(0);
  expect(await nativePublicationCheckpoint(f.env, {...f.input, point: 'before-ref-update', candidate: {...f.input.candidate, acceptedTarget: undefined}})).toBe('continue');
});
test('callback must echo actual post-deployment Worker identity; forged/oversized response cannot release CAS', async () => {
  const f = fixture();
  f.env.C03_PUBLICATION_CHECKPOINT = {fetch: async () => Response.json({caseId: f.grant.caseId, journalId: f.grant.journalId, workerVersion: crypto.randomUUID(), point: 'before-ref-update', action: 'continue'})};
  expect(await nativePublicationCheckpoint(f.env, {...f.input, point: 'before-ref-update'})).toBe('held');
  f.env.C03_PUBLICATION_CHECKPOINT = {fetch: async () => new Response(' '.repeat(1025))};
  expect(await nativePublicationCheckpoint(f.env, {...f.input, point: 'before-ref-update'})).toBe('held');
});
test('two private checkpoint cases select their own exact callback while both before-CAS points continue',async()=>{const f=fixture(),second={...f.grant,caseId:crypto.randomUUID(),workflowId:'workflow-b',candidateId:'candidate-b',journalId:'journal-b',commit:'e'.repeat(40)},inputB={...f.input,workflowId:second.workflowId,commit:second.commit,candidate:{...f.input.candidate,id:second.candidateId,candidateCommit:second.commit,review:{...f.input.candidate.review!,commit:second.commit}},journal:{...f.input.journal,id:second.journalId,candidateId:second.candidateId,newHead:second.commit,publicationAuthority:{...f.input.journal.publicationAuthority!,commit:second.commit}}};delete f.env.C03_PUBLICATION_CHECKPOINT_GRANT_JSON;f.env.C03_PUBLICATION_CHECKPOINT_GRANTS_JSON=JSON.stringify([f.grant,second]);const cases:string[]=[];f.env.C03_PUBLICATION_CHECKPOINT={fetch:async request=>{const body=await(request as Request).json() as{grant:typeof f.grant;workerVersion:string;point:string};cases.push(body.grant.caseId);return Response.json({caseId:body.grant.caseId,journalId:body.grant.journalId,workerVersion:body.workerVersion,point:body.point,action:'continue'});}};expect(await Promise.all([nativePublicationCheckpoint(f.env,{...f.input,point:'before-ref-update'}),nativePublicationCheckpoint(f.env,{...inputB,point:'before-ref-update'})])).toEqual(['continue','continue']);expect(new Set(cases)).toEqual(new Set([f.grant.caseId,second.caseId]));});
test('actual local Git force-with-lease is untouched before hold and committed after hold; journal stays prepared', async () => {
  const root = await mkdtemp(join(tmpdir(), 'c03-real-ref-checkpoint-')), work = join(root, 'work'), remote = join(root, 'canonical.git');
  const git = (...args: string[]) => {const result = Bun.spawnSync(['git', ...args]); if (result.exitCode !== 0) throw Error('Owned local Git fixture command failed'); return result.stdout.toString().trim();};
  try {
    git('init', '--bare', remote); git('init', '-b', 'main', work);
    await Bun.write(join(work, 'base.txt'), 'Owned synthetic local checkpoint fixture'); git('-C', work, 'add', '.'); git('-C', work, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Base');
    const base = git('-C', work, 'rev-parse', 'HEAD'); git('-C', work, 'push', remote, 'HEAD:refs/heads/main');
    await Bun.write(join(work, 'addition.txt'), 'Additive contribution'); git('-C', work, 'add', '.'); git('-C', work, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Additive');
    const commit = git('-C', work, 'rev-parse', 'HEAD'), tree = git('-C', work, 'rev-parse', 'HEAD^{tree}'), f = fixture();
    f.input.commit = commit; f.input.candidate.candidateCommit = commit; f.input.candidate.expectedAcceptedBase = base; f.input.candidate.acceptedTarget!.acceptedCommit = base; f.input.candidate.review!.commit = commit; f.input.journal.newHead = commit; f.input.journal.candidateTree = tree; f.input.journal.publicationAuthority!.commit = commit; f.input.journal.publicationAuthority!.tree = tree;
    f.grant.commit = commit; f.grant.tree = tree; f.grant.acceptedCommit = base; f.env.C03_PUBLICATION_CHECKPOINT_GRANT_JSON = JSON.stringify(f.grant);
    let holdBefore = true, dispatched = 0;
    f.env.C03_PUBLICATION_CHECKPOINT = {fetch: async request => {const body = await (request as Request).json() as {point: string}; return f.response(body.point, holdBefore || body.point === 'after-ref-update' ? 'hold' : 'continue');}};
    const dispatch = async () => {dispatched++; expect(git('--git-dir', remote, 'rev-parse', 'refs/heads/main')).toBe(base); git('-C', work, 'push', '--quiet', '--force-with-lease=refs/heads/main:' + base, remote, commit + ':refs/heads/main'); return {success: true};};
    expect((await checkpointedNativeRefUpdate(f.env, f.input, dispatch)).kind).toBe('held-before'); expect(dispatched).toBe(0); expect(git('--git-dir', remote, 'rev-parse', 'refs/heads/main')).toBe(base);
    holdBefore = false;
    expect((await checkpointedNativeRefUpdate(f.env, f.input, dispatch)).kind).toBe('held-after'); expect(dispatched).toBe(1); expect(git('--git-dir', remote, 'rev-parse', 'refs/heads/main')).toBe(commit); expect(f.input.journal.state).toBe('PREPARED');
    git('--git-dir', remote, 'merge-base', '--is-ancestor', base, commit);
  } finally {await rm(root, {recursive: true, force: true});}
});
