import { expect, test } from 'bun:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { workerdChild } from './support/workerd-child';
import type { RetainedInput } from '../src/server/retained-inputs';
test('native SQLite retained input authority, exact rebase replay and post-withdrawal credential cleanup', async () => { if (await workerdChild('tests/retained-input-native.test.ts'))
    return; const file = `/tmp/retained-native-${crypto.randomUUID()}.js`, build = Bun.spawn([process.execPath, 'build', 'tests/support/retained-input-native-worker.ts', '--target=browser', '--external=cloudflare:workers', '--external=node:*', `--outfile=${file}`], { stdout: 'ignore', stderr: 'pipe' }); const [error, exit] = await Promise.all([new Response(build.stderr).text(), build.exited]); if (exit)
    throw Error(error); const script = await Bun.file(file).text(); await Bun.file(file).delete(); const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'retained', modules: true, script, compatibilityDate: '2026-10-02', compatibilityFlags: ['nodejs_compat'], bindings: { CORE_GIT_GLOBAL_MONTHLY_USD_MICROS: '5000000', CORE_GIT_ACCOUNT_MONTHLY_USD_MICROS: '2500000', REPOSITORY_READ_GLOBAL_MONTHLY_USD_MICROS: '2000000', REPOSITORY_READ_ACCOUNT_MONTHLY_USD_MICROS: '1000000' }, durableObjects: { REPOSITORY_CONTROLLER: { className: 'RetainedNativeFixture', useSQLite: true } } }] })); const call = async (path: string, input?: RetainedInput) => (await mf.getWorker('retained')).fetch(`http://fixture${path}`, input ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : undefined); try {
    const seeded = await call('/seed');
    if (!seeded.ok)
        throw Error(await seeded.text());
    expect(seeded.status).toBe(200);
    const historicalInputs: RetainedInput[] = [];
    for (let index = 0; index < 4; index++)
        historicalInputs.push(await (await call(`/input?id=${crypto.randomUUID()}`)).json() as RetainedInput);
    const [issued, readOnly, workspaceOnly, unknown] = historicalInputs as [
        RetainedInput,
        RetainedInput,
        RetainedInput,
        RetainedInput
    ];
    expect((await call('/historical-begin', issued)).status).toBe(200);
    expect((await call('/historical-issued', issued)).status).toBe(200);
    expect((await call('/historical-begin?scope=read', readOnly)).status).toBe(200);
    expect((await call('/historical-issued', readOnly)).status).toBe(200);
    expect((await call('/historical-begin?purpose=workspace', workspaceOnly)).status).toBe(200);
    expect((await call('/historical-issued?purpose=workspace', workspaceOnly)).status).toBe(200);
    expect((await call('/historical-begin', unknown)).status).toBe(200);
    await call('/advance');
    for (const denied of [readOnly, workspaceOnly, unknown, { ...issued, candidateId: 'forged-candidate' }, { ...issued, base: 'f'.repeat(40) }])
        expect((await call('/record', denied)).status).toBe(409);
    const recordedHistorical = await call('/record', issued);
    if (!recordedHistorical.ok)
        throw Error(await recordedHistorical.text());
    expect((await recordedHistorical.json() as RetainedInput).commit).toBe('a'.repeat(40));
    expect((await (await call('/state')).json() as {
        task: {
            currentCommit: string;
        };
    }).task.currentCommit).toBe('e'.repeat(40));
    expect((await call('/intent', issued)).status).toBe(409);
    await call('/withdraw-actor-await');
    expect((await call('/record', issued)).status).toBe(409);
    await call('/restore-actor');
    await call('/withdraw-owner-await');
    expect((await call('/record', issued)).status).toBe(409);
    await call('/restore-owner');
    await call('/provider-mode');
    expect(await (await call('/historical-close', issued)).json()).toBe(true);
    expect(await (await call('/historical-close', readOnly)).json()).toBe(true);
    expect(await (await call('/historical-close?purpose=workspace', workspaceOnly)).json()).toBe(true);
    await call('/clear-calls');
    await call('/provider-mode?fail=1');
    await call('/reset-checkpoint');
    const input = await (await call(`/input?id=${crypto.randomUUID()}`)).json() as RetainedInput;
    expect((await call('/record', { ...input, protectedRef: 'refs/heads/main' })).status).toBe(409);
    expect((await call('/record', { ...input, canonicalRepoName: 'other-repository' })).status).toBe(409);
    expect((await call('/record', { ...input, candidateId: 'other-candidate' })).status).toBe(409);
    expect((await call('/withdraw-actor-await')).status).toBe(200);
    expect((await call('/record', input)).status).toBe(409);
    await call('/restore-actor');
    expect((await call('/record', input)).status).toBe(200);
    expect((await call('/record', { ...input, workflowId: 'wrong-workflow' })).status).toBe(409);
    await call('/withdraw-owner-await');
    expect((await call('/record', input)).status).toBe(409);
    await call('/restore-owner');
    expect((await call('/intent', input)).status).toBe(200);
    expect((await call('/apply', input)).status).toBe(409);
    expect((await call('/wrong-remote', input)).status).toBe(409);
    expect((await call('/remote', input)).status).toBe(200);
    const appliedResponse = await call('/apply', input);
    if (!appliedResponse.ok)
        throw Error(await appliedResponse.text());
    expect(appliedResponse.status).toBe(200);
    const applied = await (await call('/state')).json();
    expect((await call('/apply', input)).status).toBe(200);
    expect(await (await call('/state')).json()).toEqual(applied);
    await call('/advance');
    expect((await call('/apply', input)).status).toBe(200);
    const advanced = await (await call('/state')).json() as {
        task: {
            currentCommit: string;
        };
    };
    expect(advanced.task.currentCommit).toBe('e'.repeat(40));
    const current = await (await call(`/input?id=${crypto.randomUUID()}`)).json() as RetainedInput;
    expect((await call('/credential-begin', current)).status).toBe(200);
    const bounded = { ...current, id: crypto.randomUUID() };
    expect((await call('/credential-begin', bounded)).status).toBe(200);
    const beyond = Array.from({ length: 21 }, (_, index) => ({ ...current, id: `${(index + 1).toString(16).padStart(8, '0')}-1234-4234-8234-123456789abc` }));
    // These are explicitly historical incidents without a prepaid cleanup group.
    for (const entry of beyond)
        expect((await call('/credential-begin-legacy', entry)).status).toBe(200);
    await call('/withdraw-owner');
    expect((await call('/credential-record', current)).status).toBe(200);
    const summary = await (await call('/credential-summary', current)).text();
    expect(summary).not.toContain('synthetic-server-only-token');
    expect(summary).not.toContain('repoName');
    await call('/provider-mode');
    expect(await (await call('/credential-revoke', current)).json()).toBe(true);
    expect((await (await call('/credential-summary', current)).json() as {
        status: string;
    }).status).toBe('revoked');
    expect(await (await call('/calls')).json()).toEqual(['synthetic-workspace']);
    expect((await call('/credential-record', bounded)).status).toBe(200);
    await call('/provider-mode?fail=1');
    for (let index = 0; index < 5; index++)
        await call('/alarm');
    expect((await (await call('/calls')).json() as string[]).length).toBe(5);
    expect((await (await call('/credential-summary', bounded)).json() as {
        status: string;
    }).status).toBe('pending');
    await call('/credential-expire', bounded);
    const expired = await (await call('/credential-summary', bounded)).text();
    expect(expired).toContain('expired_unverified');
    expect(expired).not.toContain('synthetic-server-only-token');
    for (const entry of beyond)
        expect((await call('/credential-record', entry)).status).toBe(200);
    await call('/budget-exhaust');
    const beforeDenied = await (await call('/calls')).json();
    for (let index = 0; index < 4; index++)
        await call('/alarm');
    expect(await (await call('/calls')).json()).toEqual(beforeDenied);
    await call('/budget-fund');
    await call('/provider-mode');
    const last = beyond.at(-1)!;
    expect(await (await call('/credential-revoke', last)).json()).toBe(true);
    expect((await (await call('/credential-summary', last)).json() as {
        status: string;
    }).status).toBe('revoked');
    expect((await (await call('/credential-summary', beyond[0]!)).json() as {
        status: string;
    }).status).toBe('pending');
}
finally {
    await mf.dispose();
} }, 30000);
