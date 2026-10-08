import {expect, test} from 'bun:test';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';

test('signed HTTP archive state is owner-only, read-only while archived, and restored by unarchive', async () => {
  if (await workerdChild('tests/repository-lifecycle-http.test.ts')) return;
  const pair = await generateKeyPair('RS256');
  const jwk = {...await exportJWK(pair.publicKey), kid: 'lifecycle-local', alg: 'RS256', use: 'sig'};
  const issuer = Bun.serve({hostname: '127.0.0.1', port: 0, fetch: () => Response.json({keys: [jwk]})});
  const file = `/tmp/repository-lifecycle-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, 'build', 'tests/support/repository-lifecycle-http-worker.ts', '--target=browser', '--external=cloudflare:workers', '--external=node:*', '--outfile=' + file], {stdout: 'ignore', stderr: 'pipe'});
  if (await build.exited) throw Error(await new Response(build.stderr).text());
  const script = await Bun.file(file).text();
  await Bun.file(file).delete();
  const mf = new Miniflare(convertV4MiniflareOptions({workers: [{
    name: 'lifecycle', modules: true, script, compatibilityDate: '2026-10-02', compatibilityFlags: ['nodejs_compat'],
    bindings: {FIXTURE_ISSUER: issuer.url.origin},
    durableObjects: {REPOSITORY_CONTROLLER: {className: 'RepositoryLifecycleFixture', useSQLite: true}},
  }]}));
  try {
    const worker = await mf.getWorker('lifecycle');
    const sign = (subject: string) => new SignJWT({azp: 'https://fixture.example'}).setProtectedHeader({alg: 'RS256', kid: jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
    const owner = await sign('owner');
    const member = await sign('member');
    const life = '/api/p/p123456789abc/lifecycle';
    const call = (token: string | null, path: string, method = 'GET', value?: unknown) => worker.fetch('http://fixture' + path, {
      method,
      headers: {'CF-Connecting-IP': '198.51.100.99', ...(token ? {Authorization: 'Bearer ' + token} : {}), 'content-type': 'application/json'},
      ...(value === undefined ? {} : {body: JSON.stringify(value)}),
    });

    expect((await worker.fetch('http://fixture/fixture/seed')).status).toBe(200);

    // Reads: any member can see the state; anonymous callers are refused.
    const initial = await call(owner, life);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({state: 'active', archivedAt: null, version: 1});
    expect((await call(member, life)).status).toBe(200);
    expect((await call(null, life)).status).not.toBe(200);

    // Permission: only the owner can change archive state.
    const memberArchive = await call(member, life, 'POST', {action: 'archive'});
    expect(memberArchive.status).toBe(403);
    expect(await memberArchive.text()).toBe('Only the current repository owner can change archive state');

    // Input: exact action only; unknown fields and other actions are refused.
    expect((await call(owner, life, 'POST', {action: 'delete'})).status).toBe(400);
    expect((await call(owner, life, 'POST', {action: 'archive', extra: true})).status).toBe(400);
    expect((await call(owner, life, 'PUT', {action: 'archive'})).status).toBe(405);

    // Owner archives once; the state and version are persisted.
    const archived = await call(owner, life, 'POST', {action: 'archive'});
    expect(archived.status).toBe(200);
    const archivedBody = await archived.json() as {state: string; archivedAt: string | null; version: number};
    expect(archivedBody.state).toBe('archived');
    expect(archivedBody.version).toBe(2);
    expect(typeof archivedBody.archivedAt).toBe('string');
    expect((await call(owner, life)).status).toBe(200);
    expect(await (await call(owner, life)).json()).toEqual(archivedBody);

    // Negative: archiving an already archived repository is refused and changes nothing.
    const twice = await call(owner, life, 'POST', {action: 'archive'});
    expect(twice.status).toBe(409);
    expect(await twice.text()).toBe('Repository is already archived');

    // Read-only guard: a write on an archived repository is refused before it reaches the workflow.
    const write = await call(owner, '/api/p/p123456789abc/candidates/candidate/verification-closure', 'POST', {workflowId: 'workflow', commit: 'b'.repeat(40), evidenceId: 'evidence'});
    expect(write.status).toBe(409);
    expect(await write.text()).toBe('Repository is archived and read-only; unarchive it to change anything');

    // Unarchive restores active state and a new version; the write guard no longer applies.
    const restored = await call(owner, life, 'POST', {action: 'unarchive'});
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual({state: 'active', archivedAt: null, version: 3});
    const afterRestore = await call(owner, '/api/p/p123456789abc/candidates/candidate/verification-closure', 'POST', {workflowId: 'workflow', commit: 'b'.repeat(40), evidenceId: 'evidence'});
    expect(await afterRestore.text()).not.toBe('Repository is archived and read-only; unarchive it to change anything');

    // Negative: unarchiving an active repository is refused.
    const notArchived = await call(owner, life, 'POST', {action: 'unarchive'});
    expect(notArchived.status).toBe(409);
    expect(await notArchived.text()).toBe('Repository is not archived');
  } finally {
    await mf.dispose();
    issuer.stop(true);
  }
}, 60000);
