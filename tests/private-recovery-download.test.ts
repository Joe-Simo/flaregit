import { createHash } from 'node:crypto';
import { expect, test } from 'bun:test';
import { downloadPrivateRecovery, type PrivateRecoveryDownloadOptions } from '../src/server/private-recovery-download';
function fixture(size = 131072) {
  let active = true, calls = 0, gets = 0, cancelled = false;
  const sha256 = createHash('sha256').update(new Uint8Array(size)).digest('hex');
  const snapshot = { projectId: 'repo', incarnation: 'generation', commit: 'a'.repeat(40), tree: 'b'.repeat(40), journalId: 'journal', objectScope: 'exact-accepted-reachable-closure' as const };
  const options: PrivateRecoveryDownloadOptions = {
    snapshot, objectKey: 'private/key', receipt: { ...snapshot, size, sha256, objectCount: 2, createdAt: '2026-10-02T00:00:00.000Z' },
    authorize: async () => { calls++; return active; },
    getObject: async () => { gets++; return { size, customMetadata: { ...snapshot, sha256 }, checksums: { sha256: Uint8Array.from(sha256.match(/../g)!, part => Number.parseInt(part, 16)).buffer }, body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(size)); controller.close(); }, cancel() { cancelled = true; } }) }; },
  };
  return { options, revoke: () => { active = false; }, counts: () => ({ calls, gets, cancelled }) };
}
const request = (method = 'GET') => new Request('https://flaregit.test/private/recovery', { method });
test('fresh authorization precedes storage and every bounded delivery chunk', async () => {
  const f = fixture(); const response = await downloadPrivateRecovery(request(), f.options);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Content-Disposition')).toBe(`attachment; filename="recovery-${'a'.repeat(40)}.bundle"`);
  const reader = response.body!.getReader(); expect((await reader.read()).value?.byteLength).toBe(65536);
  expect(f.counts().calls).toBe(3); f.revoke();
  await expect(reader.read()).rejects.toThrow('interrupted');
});
test('revocation prevents R2 lookup', async () => {
  const f = fixture(); f.revoke(); expect((await downloadPrivateRecovery(request(), f.options)).status).toBe(403); expect(f.counts().gets).toBe(0);
});
test('explicit snapshot identity and maximum size are mandatory before R2', async () => {
  for (const invalid of [ { ...fixture().options.receipt, incarnation: 'other' }, { ...fixture().options.receipt, size: 512 * 1024 * 1024 + 1 } ]) {
    const f = fixture(); f.options.receipt = invalid; expect((await downloadPrivateRecovery(request(), f.options)).status).toBe(409); expect(f.counts().gets).toBe(0);
  }
});
test('R2 checksum and exact closure scope must match trusted receipt', async () => {
  for (const field of ['sha256', 'journalId'] as const) {
    const f = fixture(); f.options.receipt = { ...f.options.receipt, [field]: 'f'.repeat(64) };
    if (field === 'journalId') f.options.snapshot = { ...f.options.snapshot, journalId: 'f'.repeat(64) };
    expect((await downloadPrivateRecovery(request(), f.options)).status).toBe(409); expect(f.counts().cancelled).toBe(true);
  }
});
test('HEAD validates and cancels storage body without delivering it', async () => {
  const f = fixture(); const response = await downloadPrivateRecovery(request('HEAD'), f.options); expect(response.body).toBeNull(); expect(f.counts().calls).toBe(2); expect(f.counts().cancelled).toBe(true);
});
test('authority errors suppress callback details and cancel storage', async () => {
  const f = fixture(); let calls = 0; f.options.authorize = async () => { if (++calls > 1) throw new Error('secret token'); return true; };
  const response = await downloadPrivateRecovery(request(), f.options); expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret'); expect(f.counts().cancelled).toBe(true);
});
test('full transfer validates actual length and gets only trusted receipt key', async () => {
  const f = fixture(7); const response = await downloadPrivateRecovery(request(), f.options); expect((await response.arrayBuffer()).byteLength).toBe(7); expect(f.counts().gets).toBe(1);
});

test('production multipart metadata validates when R2 has no SHA256 checksum', async () => {
  const f = fixture(7); const get = f.options.getObject;
  f.options.getObject = async key => { const object = await get(key); return object ? { ...object, checksums: {} } : null; };
  const response = await downloadPrivateRecovery(request(), f.options);
  expect(response.status).toBe(200); expect((await response.arrayBuffer()).byteLength).toBe(7);
});

for (const mutation of ['last-byte', 'short', 'long'] as const) test(`actual stream digest and length reject ${mutation}`, async () => {
  const f = fixture(131072); const get = f.options.getObject;
  f.options.getObject = async key => {
    const object = (await get(key))!;
    const bytes = new Uint8Array(mutation === 'short' ? 131071 : mutation === 'long' ? 131073 : 131072);
    if (mutation === 'last-byte') bytes[bytes.length - 1] = 1;
    return { ...object, checksums: {}, body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
  };
  const response = await downloadPrivateRecovery(request(), f.options);
  await expect(response.arrayBuffer()).rejects.toThrow('interrupted');
});
