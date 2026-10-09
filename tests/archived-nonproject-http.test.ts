import {expect, test} from 'bun:test';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';

const ARCHIVED = 'Repository is archived and read-only; unarchive it to change anything';

test('an archived repository refuses writes on the four guarded non-project routes and still serves reads', async () => {
  if (await workerdChild('tests/archived-nonproject-http.test.ts')) return;
  const pair = await generateKeyPair('RS256');
  const jwk = {...await exportJWK(pair.publicKey), kid: 'archived-nonproject', alg: 'RS256', use: 'sig'};
  const issuer = Bun.serve({hostname: '127.0.0.1', port: 0, fetch: () => Response.json({keys: [jwk]})});
  const file = `/tmp/archived-nonproject-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, 'build', 'tests/support/archived-nonproject-http-worker.ts', '--target=browser', '--external=cloudflare:workers', '--external=node:*', '--outfile=' + file], {stdout: 'ignore', stderr: 'pipe'});
  if (await build.exited) throw Error(await new Response(build.stderr).text());
  const script = await Bun.file(file).text();
  await Bun.file(file).delete();
  const mf = new Miniflare(convertV4MiniflareOptions({workers: [{
    name: 'archived-nonproject', modules: true, script, compatibilityDate: '2026-10-02', compatibilityFlags: ['nodejs_compat'],
    bindings: {FIXTURE_ISSUER: issuer.url.origin},
    durableObjects: {REPOSITORY_CONTROLLER: {className: 'ArchivedNonprojectFixture', useSQLite: true}},
  }]}));
  try {
    const worker = await mf.getWorker('archived-nonproject');
    const sign = (subject: string) => new SignJWT({azp: 'https://fixture.example'}).setProtectedHeader({alg: 'RS256', kid: jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
    const member = await sign('member');
    const send = (path: string, method: string, body?: unknown, token?: string) => worker.fetch('http://fixture' + path, {
      method,
      headers: {'CF-Connecting-IP': '198.51.100.99', ...(token ? {Authorization: 'Bearer ' + token} : {}), 'content-type': 'application/json'},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    expect((await worker.fetch('http://fixture/fixture/seed')).status).toBe(200);

    // 1. Connection event callback: refused before the signing configuration is read.
    const callback = await send('/api/p/p123456789abc/connections/svc_11111111-1111-4111-8111-111111111111/events', 'POST', {}, member);
    expect(callback.status).toBe(409);
    expect(await callback.text()).toBe(ARCHIVED);

    // 2. Public participation (community posts): refused before the public grant is read.
    const participation = await send('/api/public/p123456789abc/community/posts', 'POST', {}, member);
    expect(participation.status).toBe(409);
    expect(await participation.text()).toBe(ARCHIVED);

    // 3. Public discussion changes: refused before the public grant is read.
    const discussion = await send('/api/public/p123456789abc/discussions', 'POST', {}, member);
    expect(discussion.status).toBe(409);
    expect(await discussion.text()).toBe(ARCHIVED);

    // 4. Invitation join by a signed-in member: refused after authentication and before membership changes.
    const join = await send('/api/join', 'POST', {projectId: 'p123456789abc', token: 'b'.repeat(48), requestId: crypto.randomUUID()}, member);
    expect(join.status).toBe(409);
    expect(await join.text()).toBe(ARCHIVED);

    // Reads on the same public route are not refused by the archive guard.
    const read = await send('/api/public/p123456789abc/community/posts', 'GET');
    expect(await read.text()).not.toBe(ARCHIVED);
  } finally {
    await mf.dispose();
    issuer.stop(true);
  }
}, 60000);
