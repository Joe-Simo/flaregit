import { expect, test } from 'bun:test';

test('real webhook transport preserves stable identity through lost ACK, durable consumer restart, retry and explicit replay', async () => {
  const child = Bun.spawn([process.execPath, 'tests/support/webhook-consumer-proof.ts'], { stdout: 'pipe', stderr: 'pipe' });
  const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(error);
  expect(JSON.parse(out)).toEqual({ evidence: 'local-only', signedReceipts: 3, duplicates: 2, semanticActions: 1, retainedCommitRecovered: true });
}, 15_000);
