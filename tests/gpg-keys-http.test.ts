import {expect, test} from 'bun:test';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';

// Public key produced by GnuPG 2.5 (Ed25519); its fingerprint is checked against `gpg --list-keys`.
const PUBLIC_KEY = `-----BEGIN PGP PUBLIC KEY BLOCK-----

mDMEascC/xYJKwYBBAHaRw8BAQdAHFwYf7/wicl8pPpZMNsMgyhnYfIgFFIjWUHu
CObHvZ60G0ZpeHR1cmUgPGZpeHR1cmVAbG9jYWxob3N0PoivBBMWCgBXFiEEFL10
tsdm2lf5+xaJ34iRBEgu6xAFAmrHAv8bFIAAAAAABAAObWFudTIsMi41KzEuMTIs
MCwzAhsDBQsJCAcCAiICBhUKCQgLAgQWAgMBAh4HAheAAAoJEN+IkQRILusQy/oA
/3K9iK/6Gv0qghW2uZgjz2eNiuDkxQx1z6PRnC4VQ17OAP0cXjcaySuvxr8vXBYa
Lf+ItKHhUUC2Jda8De+6BhkeCQ==
=fqMl
-----END PGP PUBLIC KEY BLOCK-----
`;
const FINGERPRINT = '14BD74B6C766DA57F9FB1689DF889104482EEB10';

test('GPG public keys are a signed-in human resource: register, list, refuse bad input, remove', async () => {
  if (await workerdChild('tests/gpg-keys-http.test.ts')) return;
  const pair = await generateKeyPair('RS256');
  const jwk = {...await exportJWK(pair.publicKey), kid: 'gpg-keys', alg: 'RS256', use: 'sig'};
  const issuer = Bun.serve({hostname: '127.0.0.1', port: 0, fetch: () => Response.json({keys: [jwk]})});
  const file = `/tmp/gpg-keys-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, 'build', 'tests/support/repository-lifecycle-http-worker.ts', '--target=browser', '--external=cloudflare:workers', '--external=node:*', '--outfile=' + file], {stdout: 'ignore', stderr: 'pipe'});
  if (await build.exited) throw Error(await new Response(build.stderr).text());
  const script = await Bun.file(file).text();
  await Bun.file(file).delete();
  const mf = new Miniflare(convertV4MiniflareOptions({workers: [{
    name: 'gpg-keys', modules: true, script, compatibilityDate: '2026-10-02', compatibilityFlags: ['nodejs_compat'],
    bindings: {FIXTURE_ISSUER: issuer.url.origin},
    durableObjects: {REPOSITORY_CONTROLLER: {className: 'RepositoryLifecycleFixture', useSQLite: true}},
  }]}));
  try {
    const worker = await mf.getWorker('gpg-keys');
    const sign = (subject: string) => new SignJWT({azp: 'https://fixture.example'}).setProtectedHeader({alg: 'RS256', kid: jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
    const member = await sign('member');
    const send = (method: string, body?: unknown, token: string | null = member) => worker.fetch('http://fixture/api/signing-keys/gpg', {
      method,
      headers: {'CF-Connecting-IP': '198.51.100.99', ...(token ? {Authorization: 'Bearer ' + token} : {}), 'content-type': 'application/json'},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });

    expect((await send('GET', undefined, null)).status).toBe(401);
    expect(await (await send('GET')).json()).toEqual({keys: []});

    // A valid public key is registered by its uppercase fingerprint; registering it again is idempotent.
    const added = await send('POST', {key: PUBLIC_KEY});
    expect(added.status).toBe(200);
    const addedBody = await added.json() as {keys: Array<{fingerprint: string}>};
    expect(addedBody.keys.map((key) => key.fingerprint)).toEqual([FINGERPRINT]);
    expect(await (await send('POST', {key: PUBLIC_KEY})).json()).toEqual(addedBody);

    // Negative cases: malformed input, extra fields, unknown removal and wrong methods are refused.
    const malformed = await send('POST', {key: '-----BEGIN PGP PUBLIC KEY BLOCK-----\nnot a key\n-----END PGP PUBLIC KEY BLOCK-----'});
    expect(malformed.status).toBe(400);
    expect((await send('POST', {key: PUBLIC_KEY, extra: true})).status).toBe(400);
    expect((await send('POST', {key: 'ssh-ed25519 AAAA'})).status).toBe(400);
    const unknown = await send('DELETE', {fingerprint: 'DEADBEEF'});
    expect(unknown.status).toBe(400);
    expect(await unknown.text()).toBe('That GPG key is not registered');
    expect((await send('PUT', {key: PUBLIC_KEY})).status).toBe(405);

    // Removing the registered key by fingerprint empties the set.
    const removed = await send('DELETE', {fingerprint: FINGERPRINT.toLowerCase()});
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({keys: []});
  } finally {
    await mf.dispose();
    issuer.stop(true);
  }
}, 60000);
