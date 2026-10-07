import {expect, test} from 'bun:test';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {workerdChild} from './support/workerd-child';

test('actual generic preview HTTP preserves owner/current-commit permission and reports unsupported source without retry', async () => {
  if (await workerdChild('tests/preview-static-http.test.ts')) return;
  const pair = await generateKeyPair('RS256'), jwk = {...await exportJWK(pair.publicKey), kid: 'preview-static-local', alg: 'RS256', use: 'sig'};
  const issuer = Bun.serve({hostname: '127.0.0.1', port: 0, fetch: () => Response.json({keys: [jwk]})});
  const dir = await mkdtemp(join(tmpdir(), 'preview-static-http-'));
  await Bun.write(join(dir, 'harness.ts'), `
    import fixture from ${JSON.stringify(resolve('tests/support/preview-onboarding-http-worker.ts'))};
    export {PreviewOnboardingFixture} from ${JSON.stringify(resolve('tests/support/preview-onboarding-http-worker.ts'))};
    import {globalOf,projectOf} from ${JSON.stringify(resolve('src/server/projects.ts'))};
    export default {async fetch(request,env,ctx){const path=new URL(request.url).pathname;if(path==='/fixture/generic'){await projectOf(env,'p123456abcdef').setVerificationPolicy({kind:'git-integrity'});return new Response('ok');}if(path==='/fixture/unsupported'){await globalOf(env).setNativeComputeFailureReason('build-p123456abcdef-'+ 'a'.repeat(40),'preview_source_unsupported');return new Response('ok');}if(path==='/fixture/reason')return Response.json(await globalOf(env).nativeComputeFailureReason('build-p123456abcdef-'+ 'a'.repeat(40)));return fixture.fetch(request,env,ctx);}};
  `);
  const build = await Bun.build({entrypoints: [join(dir, 'harness.ts')], target: 'browser', external: ['cloudflare:workers', 'node:*']});
  if (!build.success) throw Error(build.logs.map(String).join('\n'));
  const mf = new Miniflare(convertV4MiniflareOptions({workers: [{name: 'preview-static-http-local', unsafeDirectSockets: [{host: '127.0.0.1'}], modules: true, script: await build.outputs[0]!.text(), compatibilityDate: '2026-10-02', compatibilityFlags: ['nodejs_compat'], durableObjects: {REPOSITORY_CONTROLLER: {className: 'PreviewOnboardingFixture', useSQLite: true}}, r2Buckets: ['EVIDENCE_BUCKET'], bindings: {FIXTURE_ISSUER: issuer.url.origin, PREVIEW_PROVISIONING_ENABLED: 'false', PREVIEW_PROVISIONING_GLOBAL_LIMIT: '0', PREVIEW_PROVISIONING_ACCOUNT_ID: 'a'.repeat(32), PREVIEW_PROVISIONING_API_TOKEN: 'synthetic-local-only', PREVIEW_PROVISIONING_SUBDOMAIN: 'isolated', PREVIEW_PROVISIONING_BROKER_SERVICE: 'asset-broker', PREVIEW_PROVISIONING_MODULE: 'x', PREVIEW_PROVISIONING_MODULE_SHA256: '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881', PREVIEW_PROVISIONING_COMPATIBILITY_DATE: '2026-10-02', PREVIEW_SIGNING_KEY: 'local-synthetic-preview-signing-key', MANAGED_ACCOUNT_MONTHLY_USD_MICROS: '100000', MANAGED_GLOBAL_MONTHLY_USD_MICROS: '100000'}}]}));
  try {
    const direct = await mf.unsafeGetDirectURL('preview-static-http-local');
    const call = (path: string, token?: string, body?: unknown) => fetch(new URL(path, direct), {method: body === undefined ? 'GET' : 'POST', headers: {Connection: 'close', 'CF-Connecting-IP': '198.51.100.89', ...(token ? {Authorization: 'Bearer ' + token} : {}), 'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    const session = (id: string, expired = false) => new SignJWT({azp: 'https://fixture.example'}).setProtectedHeader({alg: 'RS256', kid: jwk.kid}).setIssuer(issuer.url.origin).setSubject(id).setIssuedAt().setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 120 : '5m').sign(pair.privateKey);
    await call('/fixture/seed'); await call('/fixture/generic'); const owner = await session('owner'), member = await session('reader'), expired = await session('owner', true), path = '/api/p/p123456abcdef/preview', commit = 'a'.repeat(40);
    // Real Git-integrity policy selects ordinary repositories, not the fixture default.
    const state = await (await call('/api/p/p123456abcdef/state', owner)).json() as {verificationPolicy: object};
    expect(state.verificationPolicy).toEqual({kind: 'git-integrity'});
    expect((await call(path + '/retry', member, {commit})).status).toBe(403);
    expect((await call(path + '/retry', expired, {commit})).status).toBe(401);
    expect((await call(path + '/retry', owner, {commit: 'b'.repeat(40)})).status).toBe(409);
    expect((await call(path + '/retry', owner, {commit})).status).toBe(202);
    let settled = false;
    for (let index = 0; index < 50; index++) {if (await (await call('/fixture/reason')).json() === 'build_failed') {settled = true; break;} await new Promise(resolve => setTimeout(resolve, 10));}
    expect(settled).toBe(true);
    await call('/fixture/enable');
    const onboarding = await call('/api/p/p123456abcdef/preview-onboarding', owner, {requestId: crypto.randomUUID(), action: 'prepare'});
    expect(onboarding.status).toBe(200);
    expect((await call('/fixture/unsupported')).status).toBe(200);
    const view = await (await call(path + '?commit=' + commit, owner)).json() as {status: string; canRetry: boolean; reason: string; capability: {entrypoint: string}; generationRecovery: {canRecover: boolean}};
    expect(view.status).toBe('not_supported'); expect(view.canRetry).toBe(false); expect(view.capability.entrypoint).toBe('index.html'); expect(view.reason).toContain('README-only');
    expect(view.generationRecovery.canRecover).toBe(false);
    expect((await call(path + '/retry', owner, {commit})).status).toBe(409);
    expect((await call(path + '/recover-generation', owner, {commit, expectedGeneration: null, idempotencyKey: crypto.randomUUID()})).status).toBe(409);
  } finally {await mf.dispose(); issuer.stop(true); await rm(dir, {recursive: true, force: true});}
}, 30000);
