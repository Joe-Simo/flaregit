import { expect, test } from 'bun:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { workerdChild } from './support/workerd-child';
test('actual owner recovery HTTP verifies saved refs after original actor leaves and reconciles exactly once', async () => { if (await workerdChild('tests/rebase-recovery-http.test.ts'))
    return; const pair = await generateKeyPair('RS256'), jwk = { ...await exportJWK(pair.publicKey), kid: 'rebase-test', alg: 'RS256', use: 'sig' }; const issuer = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ keys: [jwk] }) }); const file = `/tmp/rebase-http-${crypto.randomUUID()}.js`, build = Bun.spawn([process.execPath, 'build', 'tests/support/rebase-recovery-http-worker.ts', '--target=browser', '--external=cloudflare:workers', '--external=node:*', `--outfile=${file}`], { stdout: 'ignore', stderr: 'pipe' }); const [error, code] = await Promise.all([new Response(build.stderr).text(), build.exited]); if (code)
    throw Error(error); const script = await Bun.file(file).text(); await Bun.file(file).delete(); const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'rebase-http', modules: true, script, compatibilityDate: '2026-10-02', compatibilityFlags: ['nodejs_compat'], bindings: { FIXTURE_ISSUER: issuer.url.origin, CORE_GIT_GLOBAL_MONTHLY_USD_MICROS: '5000000', CORE_GIT_ACCOUNT_MONTHLY_USD_MICROS: '2500000', REPOSITORY_READ_GLOBAL_MONTHLY_USD_MICROS: '2000000', REPOSITORY_READ_ACCOUNT_MONTHLY_USD_MICROS: '1000000' }, durableObjects: { REPOSITORY_CONTROLLER: { className: 'RebaseRecoveryHttpFixture', useSQLite: true } } }] })); const call = async (path: string, token?: string, body?: unknown) => (await mf.getWorker('rebase-http')).fetch(`http://fixture${path}`, { method: body ? 'POST' : 'GET', headers: { 'CF-Connecting-IP': '198.51.100.30', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); const session = (who: string) => new SignJWT({ azp: 'https://fixture.example' }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer(issuer.url.origin).setSubject(who).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey); const route = '/api/p/p123456789abc/rebase-applications'; try {
    const seed = await call('/fixture/seed');
    if (!seed.ok)
        throw Error(await seed.text());
    const seeded = await seed.json() as {
        token: string;
        id: string;
    }, owner = await session('owner'), member = await session('member'), endpoint = `${route}/${seeded.id}/reconcile`;
    expect((await call(route)).status).toBe(401);
    expect((await call(route, member)).status).toBe(403);
    expect((await call(route, seeded.token)).status).toBe(403);
    const list = await call(route, owner);
    expect(list.status).toBe(200);
    const text = await list.text();
    for (const hidden of ['actorId', 'accountKey', 'original-actor', 'old-workflow', 'synthetic-server'])
        expect(text).not.toContain(hidden);
    const version = (JSON.parse(text) as {
        applications: Array<{
            version: number;
        }>;
    }).applications[0]!.version;
    const attempt = () => ({ expectedVersion: version, idempotencyKey: crypto.randomUUID() });
    const before = await (await call('/fixture/snapshot')).json();
    await call('/fixture/budget?deny=1');
    expect((await call(endpoint, owner, attempt())).status).toBe(429);
    expect(await (await call('/fixture/calls')).json()).toEqual([]);
    await call('/fixture/budget');
    for (const [value, status] of [['unavailable', 503], ['wrong-pin', 503], ['newer', 409], ['old', 409]] as const) {
        await call(`/fixture/mode?value=${value}`);
        expect((await call(endpoint, owner, attempt())).status).toBe(status);
        expect(await (await call('/fixture/snapshot')).json()).toEqual(before);
    }
    for (const [value, status] of [['withdraw', 503], ['advance', 503], ['lifecycle', 503], ['agent-start', 503]] as const) {
        await call(`/fixture/mode?value=${value}`);
        const denied = await call(endpoint, owner, attempt());
        expect(denied.status).toBe(status);
        const after = await (await call('/fixture/snapshot')).json() as {
            accepted: unknown;
            application: unknown;
            receipts: unknown[];
        };
        expect(after.accepted).toEqual((before as {
            accepted: unknown;
        }).accepted);
        expect(after.application).toEqual((before as {
            application: unknown;
        }).application);
        expect(after.receipts).toEqual([]);
        await call('/fixture/restore');
    }
    await call('/fixture/mode?value=normal');
    await call('/fixture/raw-ref?bad=1');
    expect((await call(endpoint, owner, attempt())).status).toBe(409);
    expect(await (await call('/fixture/calls')).json()).toEqual([]);
    await call('/fixture/raw-ref');
    const duringExpiry = await (await call('/fixture/expiry-await')).json() as {
        ok: boolean;
    };
    expect(duringExpiry.ok).toBe(false);
    expect((await (await call('/fixture/calls')).json() as string[]).some(value => value.startsWith('get:'))).toBe(true);
    const afterExpiry = await (await call('/fixture/snapshot')).json() as {
        application: unknown;
        accepted: unknown;
    };
    expect(afterExpiry.application).toEqual((before as {
        application: unknown;
    }).application);
    expect(afterExpiry.accepted).toEqual((before as {
        accepted: unknown;
    }).accepted);
    await call('/fixture/mode?value=normal');
    const expired = await (await call('/fixture/expired')).json() as {
        ok: boolean;
    };
    expect(expired.ok).toBe(false);
    expect(await (await call('/fixture/calls')).json()).toEqual([]);
    const freshList = await (await call(route, owner)).json() as {
        applications: Array<{
            version: number;
        }>;
    };
    const request = { expectedVersion: freshList.applications[0]!.version, idempotencyKey: crypto.randomUUID() };
    await call('/fixture/mode?value=lost-ack');
    const uncertain = await call(endpoint, owner, request);
    expect(uncertain.status).toBe(503);
    const callsAfterLost = await (await call('/fixture/calls')).json();
    const applied = await call(endpoint, owner, request);
    expect(await (await call('/fixture/calls')).json()).toEqual(callsAfterLost);
    if (!applied.ok)
        throw Error(await applied.text());
    expect(applied.status).toBe(200);
    const receipt = await applied.json();
    const reads = await (await call('/fixture/calls')).json();
    expect((reads as string[]).filter(x => x.startsWith('log:'))).toHaveLength(5);
    const changed = await (await call('/fixture/snapshot')).json() as {
        accepted: unknown;
        task: {
            currentCommit: string;
            baseCommit: string;
            status: string;
            blockedReason: string;
            checkpoints: unknown[];
            goal: string;
            requirements: unknown[];
        };
    };
    expect(changed.accepted).toEqual((before as {
        accepted: unknown;
    }).accepted);
    expect(changed.task.currentCommit).toBe('c'.repeat(40));
    expect(changed.task.baseCommit).toBe('d'.repeat(40));
    expect(changed.task.status).toBe('blocked');
    expect(changed.task.blockedReason).toBe('Unrelated maintainer decision remains unresolved');
    for (const field of ['checkpoints', 'goal', 'requirements'] as const)
        expect(changed.task[field]).toEqual((before as {
            task: typeof changed.task;
        }).task[field]);
    await call('/fixture/advance');
    expect(await (await call(endpoint, owner, request)).json()).toEqual(receipt);
    expect(await (await call('/fixture/calls')).json()).toEqual(reads);
    expect((await (await call('/fixture/snapshot')).json() as {
        task: {
            currentCommit: string;
        };
    }).task.currentCommit).toBe('e'.repeat(40));
    await call('/fixture/audit-capacity');
    const cappedBefore = await (await call('/fixture/snapshot')).json();
    expect((await call(endpoint, owner, { expectedVersion: request.expectedVersion, idempotencyKey: crypto.randomUUID() })).status).toBe(429);
    expect(await (await call('/fixture/calls')).json()).toEqual([]);
    expect(await (await call('/fixture/snapshot')).json()).toEqual(cappedBefore);
    expect(await (await call(endpoint, owner, request)).json()).toEqual(receipt);
    expect(await (await call('/fixture/calls')).json()).toEqual([]);
    await call('/fixture/incarnation');
    const scopedBefore = await (await call('/fixture/snapshot')).json();
    const staleScope = await call(endpoint, owner, request);
    expect(staleScope.status).toBe(409);
    const scopedBody = await staleScope.text();
    expect(scopedBody).not.toContain('originalCommit');
    expect(scopedBody).not.toContain('report');
    expect(await (await call('/fixture/calls')).json()).toEqual([]);
    expect(await (await call('/fixture/snapshot')).json()).toEqual(scopedBefore);
    expect((await (await call(route, owner)).json() as {
        applications: unknown[];
    }).applications).toEqual([]);
}
finally {
    await mf.dispose();
    issuer.stop(true);
} }, 30000);
