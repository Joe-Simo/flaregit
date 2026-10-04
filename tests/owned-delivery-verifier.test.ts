import { expect, test } from 'bun:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { workerdChild } from './support/workerd-child';

test('owned verifier validates signed scope, commits before failure, and deduplicates replay without executing deployment', async () => {
  if (await workerdChild('tests/owned-delivery-verifier.test.ts')) return;
  const build = await Bun.build({ entrypoints: ['fixtures/delivery-verifier/worker.ts'], target: 'browser', external: ['cloudflare:workers'] });
  if (!build.success) throw new Error(build.logs.join('\n'));
  const secret = crypto.getRandomValues(new Uint8Array(32)), control = crypto.randomUUID();
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'owned-verifier', modules: true, script: await build.outputs[0]!.text(), compatibilityDate: '2026-10-02', bindings: { WEBHOOK_SECRET: `whsec_${Buffer.from(secret).toString('base64')}`, CONTROL_SECRET: control, EXPECTED_PROJECT: 'p123456789abc' }, durableObjects: { RECEIPTS: { className: 'DeliveryReceipts', useSQLite: true } } }] }));
  try {
    const worker = await mf.getWorker('owned-verifier');
    const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const body = JSON.stringify({ id: 'evt_local', type: 'deployment.requested', project: { id: 'p123456789abc', name: 'Private project name must not be retained' }, data: { commit: 'a'.repeat(40), tree: 'b'.repeat(40), recoverableRef: 'refs/flaregit/deployments/local' } });
    const send = async (payload = body, delivery = 'dlv_local', timestamp = String(Math.floor(Date.now() / 1000))) => {
      const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${delivery}.${timestamp}.${payload}`))).toString('base64');
      return worker.fetch('https://owned.example/webhook', { method: 'POST', headers: { 'webhook-sequence': '1', 'webhook-id': delivery, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` }, body: payload });
    };
    const report = async () => (await worker.fetch('https://owned.example/report', { headers: { Authorization: `Bearer ${control}` } })).json() as Promise<{ evidence: string; deploymentExecuted: boolean; deliveries: Array<{ receipts: number }>; actions: Array<{ event_id: string; commit_sha: string; tree_sha: string; ref: string }> }>;
    expect((await worker.fetch('https://owned.example/report')).status).toBe(401);
    for (const authorization of [control, `Basic ${control}`, `bearer ${control}`, `Bearer  ${control}`, `Bearer ${control} extra`, `Bearer ${'x'.repeat(36)}`]) {
      expect((await worker.fetch('https://owned.example/report', { headers: { Authorization: authorization } })).status).toBe(401);
      expect((await worker.fetch('https://owned.example/mode', { method: 'POST', headers: { Authorization: authorization }, body: JSON.stringify({ mode: 'healthy' }) })).status).toBe(401);
    }
    expect((await worker.fetch('https://owned.example/webhook', { method: 'POST', body })).status).toBe(401);
    expect((await send(body, 'dlv_local', '1')).status).toBe(401);
    expect((await send(body.replace('p123456789abc', 'p123456789abd'))).status).toBe(403);
    expect((await report()).actions).toEqual([]);
    expect((await send()).status).toBe(503);
    expect((await report()).actions).toEqual([{ event_id: 'evt_local', commit_sha: 'a'.repeat(40), tree_sha: 'b'.repeat(40), ref: 'refs/flaregit/deployments/local' }]);
    expect((await send()).status).toBe(204);
    expect((await send()).status).toBe(204);
    const repeated = await report(); expect(repeated.deliveries[0]!.receipts).toBe(3); expect(repeated.actions).toHaveLength(1); expect(repeated.deploymentExecuted).toBe(false);
    expect(JSON.stringify(repeated)).not.toContain('Private project name'); expect(JSON.stringify(repeated)).not.toContain('whsec_');
    expect((await send(body.replace('a'.repeat(40), 'c'.repeat(40)))).status).toBe(409);
    expect((await report()).deliveries[0]!.receipts).toBe(3);
    expect((await worker.fetch('https://owned.example/mode', { method: 'POST', headers: { Authorization: `Bearer ${control}` }, body: JSON.stringify({ mode: 'fail-always-after-commit' }) })).status).toBe(200);
    expect((await send()).status).toBe(503);
    expect((await worker.fetch('https://owned.example/mode', { method: 'POST', headers: { Authorization: `Bearer ${control}` }, body: JSON.stringify({ mode: 'healthy' }) })).status).toBe(200);
    expect((await send()).status).toBe(204);
    expect((await report()).actions).toHaveLength(1);
  } finally { await mf.dispose(); }
}, 30_000);
