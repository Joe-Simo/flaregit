import {expect, test} from 'bun:test';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';

const BLOB = 'AAAAC3NzaC1lZDI1NTE5AAAAIL+NbGiKGIW7hZQwEIsoQAQo1fH1IVFF7Tm+yeA03BEj';
const LINE = `ssh-ed25519 ${BLOB} fixture@localhost`;
const OTHER_BLOB = Buffer.from(new Uint8Array([0, 0, 0, 11, ...new TextEncoder().encode('ssh-ed25519'), 0, 0, 0, 32, ...new Uint8Array(32).fill(7)])).toString('base64');

test('signing keys are a signed-in human resource: register, list, refuse bad input, remove', async () => {
  if (await workerdChild('tests/signing-keys-http.test.ts')) return;
  const pair = await generateKeyPair('RS256');
  const jwk = {...await exportJWK(pair.publicKey), kid: 'signing-keys', alg: 'RS256', use: 'sig'};
  const issuer = Bun.serve({hostname: '127.0.0.1', port: 0, fetch: () => Response.json({keys: [jwk]})});
  const file = `/tmp/signing-keys-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, 'build', 'tests/support/repository-lifecycle-http-worker.ts', '--target=browser', '--external=cloudflare:workers', '--external=node:*', '--outfile=' + file], {stdout: 'ignore', stderr: 'pipe'});
  if (await build.exited) throw Error(await new Response(build.stderr).text());
  const script = await Bun.file(file).text();
  await Bun.file(file).delete();
  const mf = new Miniflare(convertV4MiniflareOptions({workers: [{
    name: 'signing-keys', modules: true, script, compatibilityDate: '2026-10-02', compatibilityFlags: ['nodejs_compat'],
    bindings: {FIXTURE_ISSUER: issuer.url.origin},
    durableObjects: {REPOSITORY_CONTROLLER: {className: 'RepositoryLifecycleFixture', useSQLite: true}},
  }]}));
  try {
    const worker = await mf.getWorker('signing-keys');
    const sign = (subject: string) => new SignJWT({azp: 'https://fixture.example'}).setProtectedHeader({alg: 'RS256', kid: jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
    const member = await sign('member');
    const send = (method: string, body?: unknown, token: string | null = member) => worker.fetch('http://fixture/api/signing-keys', {
      method,
      headers: {'CF-Connecting-IP': '198.51.100.99', ...(token ? {Authorization: 'Bearer ' + token} : {}), 'content-type': 'application/json'},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });

    // Anonymous callers are refused; a signed-in member lists an empty set first.
    expect((await send('GET', undefined, null)).status).toBe(401);
    expect(await (await send('GET')).json()).toEqual({keys: []});

    // Registering a valid ed25519 key returns it; registering it again is idempotent.
    const added = await send('POST', {key: LINE});
    expect(added.status).toBe(200);
    expect(await added.json()).toEqual({keys: [{type: 'ssh-ed25519', blob: BLOB, comment: 'fixture@localhost'}]});
    expect(await (await send('POST', {key: LINE})).json()).toEqual({keys: [{type: 'ssh-ed25519', blob: BLOB, comment: 'fixture@localhost'}]});

    // Negative cases: other key types, extra fields, and removing an unknown key are refused.
    const rsa = await send('POST', {key: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ user@host'});
    expect(rsa.status).toBe(400);
    expect(await rsa.text()).toBe('Only ssh-ed25519 keys can be trusted');
    expect((await send('POST', {key: LINE, extra: true})).status).toBe(400);
    const unknown = await send('DELETE', {blob: OTHER_BLOB});
    expect(unknown.status).toBe(400);
    expect(await unknown.text()).toBe('That signing key is not registered');
    expect((await send('DELETE', {blob: BLOB, extra: true})).status).toBe(400);
    expect((await send('PUT', {key: LINE})).status).toBe(405);

    // Removing the registered key empties the set.
    const removed = await send('DELETE', {blob: BLOB});
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({keys: []});
    expect(await (await send('GET')).json()).toEqual({keys: []});
  } finally {
    await mf.dispose();
    issuer.stop(true);
  }
}, 60000);
