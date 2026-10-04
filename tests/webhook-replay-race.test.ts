import { expect, test } from 'bun:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { deliverWebhook } from '../src/server/webhooks';
import type { Env } from '../src/server/env';
import { workerdChild } from './support/workerd-child';

for (const responseStatus of [503, 204]) {
const testName = `old in-flight ${responseStatus} response cannot mutate or retry a newer webhook replay generation`;
test(testName, async () => {
  if (await workerdChild('tests/webhook-replay-race.test.ts', testName)) return;
  const bundle = `/tmp/flaregit-webhook-race-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, 'build', 'tests/support/webhook-replay-worker.ts', '--target=browser', '--external=cloudflare:workers', '--external=node:*', `--outfile=${bundle}`], { stdout: 'ignore', stderr: 'pipe' });
  const [errors, code] = await Promise.all([new Response(build.stderr).text(), build.exited]);
  if (code !== 0) throw new Error(errors);
  const script = await Bun.file(bundle).text(); await Bun.file(bundle).delete();
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'webhook-race', modules: true, script, compatibilityDate: '2026-10-02', compatibilityFlags: ['nodejs_compat'], durableObjects: { TEST: { className: 'WebhookReplayFixture', useSQLite: true } } }] }));
  const nativeFetch = globalThis.fetch;
  let releaseFirst!: () => void, arrived!: () => void;
  const arrivedPromise = new Promise<void>(resolve => { arrived = resolve; });
  const releasePromise = new Promise<void>(resolve => { releaseFirst = resolve; });
  let requests = 0;
  const receiver = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    expect(request.headers.get('webhook-id')).toBe('dlv_local');
    expect(JSON.parse(await request.text()).id).toBe('evt_local');
    requests++;
    if (requests === 1) { arrived(); await releasePromise; return new Response(responseStatus === 503 ? 'Synthetic old failure' : null, { status: responseStatus }); }
    return new Response(null, { status: 204 });
  } });
  try {
    const worker = await mf.getWorker('webhook-race');
    const call = async (route: string, value?: unknown) => worker.fetch(`http://fixture${route}`, value ? { method: 'POST', body: JSON.stringify(value) } : undefined);
    await call('/seed', { secret: `whsec_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')}` });
    expect(await (await call('/legacy')).json()).toEqual({ generation: 0, attempts: 2, payload: 'legacy-payload' });
    const ledger = { getDelivery: async () => (await call('/get')).json(), isBlocked: async () => (await call('/blocked')).json(), markDelivery: async (_id: string, result: unknown) => (await call('/mark', result)).json() };
    const env = { REPOSITORY_CONTROLLER: { idFromName: (name: string) => name, get: () => ledger } } as unknown as Env;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => String(input) === 'https://receiver.fixture.example/webhook' ? nativeFetch(`http://127.0.0.1:${receiver.port}/`, init) : nativeFetch(input, init)) as typeof fetch;
    const oldAttempt = deliverWebhook(env, 'p123456789abc', 'dlv_local');
    await arrivedPromise;
    expect(await (await call('/replay')).json()).toBe(true);
    releaseFirst();
    expect(await oldAttempt).toBeNull();
    const replayed = await (await call('/get')).json() as { delivery: { status: string; attempts: number } };
    expect(replayed.delivery.status).toBe('pending');
    expect(replayed.delivery.attempts).toBe(0);
    await deliverWebhook(env, 'p123456789abc', 'dlv_local');
    expect(requests).toBe(2);
    expect((await (await call('/get')).json() as typeof replayed).delivery.status).toBe('success');
  } finally {
    releaseFirst(); globalThis.fetch = nativeFetch; receiver.stop(true); await mf.dispose();
  }
}, 30_000);

}
