import {expect, test} from 'bun:test';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
import {join} from 'node:path';
test('actual local private service stores post-upload Worker identity, refuses forgery and resumes only original held case', async () => {
  const file = import.meta.path;
  if (await workerdChild(file)) return;
  const build = await Bun.build({entrypoints: [join(import.meta.dir, '../fixtures/c03-publication-checkpoint/worker.ts')], target: 'browser', external: ['cloudflare:workers']});
  if (!build.success) throw Error(build.logs.map(String).join('\n'));
  const harness = `export default {async fetch(request,env){const body=await request.json(),path=new URL(request.url).pathname;try{if(path==='/register')return Response.json(await env.OP.register(body.grant,body.workerVersion,body.pauseAt));if(path==='/resume')return Response.json(await env.OP.resume(body.grant,body.resumeId));return env.RECEIVER.fetch(new Request('https://c03-publication-checkpoint.invalid/reached',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));}catch{return new Response('Synthetic local fixture refusal',{status:409});}}};`;
  const mf = new Miniflare(convertV4MiniflareOptions({workers: [{name: 'private-case', modules: true, script: await build.outputs[0]!.text(), compatibilityDate: '2026-10-04', durableObjects: {CASES: {className: 'PrivateCheckpointCase', useSQLite: true}}, bindings: {C03_CASE_PROJECT_ID: 'p123456789abc', C03_CASE_ACTOR_ID: 'synthetic-owner'}}, {name: 'synthetic-local-harness', modules: true, script: harness, compatibilityDate: '2026-10-04', serviceBindings: {OP: {name: 'private-case', entrypoint: 'NativeCheckpointOperator'}, RECEIVER: {name: 'private-case', entrypoint: 'NativeCheckpointReceiver'}}}]}));
  const now = Date.now(), workerVersion = crypto.randomUUID(), grant = {caseId: crypto.randomUUID(), projectId: 'p123456789abc', incarnation: crypto.randomUUID(), workflowId: 'owned-synthetic-workflow', candidateId: 'owned-synthetic-candidate', journalId: 'owned-synthetic-journal', commit: 'a'.repeat(40), tree: 'b'.repeat(40), ref: 'refs/heads/main', actorId: 'synthetic-owner', sourceVersion: 'c'.repeat(40), acceptedCommit: 'd'.repeat(40), acceptedVersion: 23, policyVersion: 7, activatedAt: now - 1, expiresAt: now + 60000};
  try {
    const operator = await mf.getWorker('synthetic-local-harness'), call = (path: string, body: object) => operator.fetch('https://local' + path, {method: 'POST', body: JSON.stringify(body)});
    expect((await (await mf.getWorker('private-case')).fetch('https://local/reached')).status).toBe(404);
    expect((await call('/reached', {grant, workerVersion, point: 'before-ref-update'})).status).toBe(409);
    expect((await call('/register', {grant: {...grant, actorId: 'other-owner'}, workerVersion, pauseAt: 'before-ref-update'})).status).toBe(409);
    expect((await call('/register', {grant: {...grant, projectId: 'p999999999999'}, workerVersion, pauseAt: 'before-ref-update'})).status).toBe(409);
    expect((await call('/register', {grant, workerVersion, pauseAt: 'before-ref-update'})).status).toBe(200);
    expect((await call('/reached', {grant, workerVersion: crypto.randomUUID(), point: 'before-ref-update'})).status).toBe(409);
    const held = await call('/reached', {grant, workerVersion, point: 'before-ref-update'}); expect((await held.json() as {action: string}).action).toBe('hold');
    const duplicate = await call('/reached', {grant, workerVersion, point: 'before-ref-update'}); expect((await duplicate.json() as {action: string}).action).toBe('hold');
    expect((await call('/register', {grant, workerVersion: crypto.randomUUID(), pauseAt: 'before-ref-update'})).status).toBe(409);
    const resumeId = crypto.randomUUID(); expect((await call('/resume', {grant, resumeId})).status).toBe(200);
    expect((await call('/resume', {grant, resumeId: crypto.randomUUID()})).status).toBe(409);
    const resumed = await call('/reached', {grant, workerVersion, point: 'before-ref-update'}); expect((await resumed.json() as {action: string}).action).toBe('continue');
    expect((await call('/reached', {grant, workerVersion, point: 'after-ref-update'})).status).toBe(200);
  } finally {await mf.dispose();}
}, 30000);
