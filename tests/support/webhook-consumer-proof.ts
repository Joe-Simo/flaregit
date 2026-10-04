import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliverWebhook } from '../../src/server/webhooks';
import type { Env } from '../../src/server/env';

// Isolated child process: the test-only transport maps exactly one synthetic
// public HTTPS hostname to its owned loopback receiver. Production URL validation
// and signing still execute unchanged; this is local evidence, not hosted proof.
const root = await mkdtemp(join(tmpdir(), 'flaregit-webhook-consumer-'));
const path = join(root, 'receipts.sqlite');
let db = new Database(path);
db.exec('CREATE TABLE inbox(delivery_id TEXT PRIMARY KEY,event_id TEXT NOT NULL,payload TEXT NOT NULL); CREATE TABLE actions(event_id TEXT PRIMARY KEY,commit_sha TEXT NOT NULL,tree_sha TEXT NOT NULL,ref TEXT NOT NULL); CREATE TABLE delivery(id TEXT PRIMARY KEY,status TEXT NOT NULL,attempts INTEGER NOT NULL,payload TEXT NOT NULL);');
const commitGit = async (args: string[]) => {
  const child = Bun.spawn(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(error);
  return out.trim();
};
const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const nativeFetch = globalThis.fetch;
const secret = crypto.getRandomValues(new Uint8Array(32));
const signingSecret = `whsec_${Buffer.from(secret).toString('base64')}`;
const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
let receipts = 0, duplicateReceipts = 0, networkCalls = 0;
const seen: Array<{ id: string; eventId: string; sequence: string; payload: string }> = [];
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const payload = await request.text(), id = request.headers.get('webhook-id') ?? '', timestamp = request.headers.get('webhook-timestamp') ?? '';
  const signature = request.headers.get('webhook-signature')?.replace(/^v1,/, '') ?? '';
  const valid = await crypto.subtle.verify('HMAC', key, Buffer.from(signature, 'base64'), new TextEncoder().encode(`${id}.${timestamp}.${payload}`));
  if (!valid || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return new Response('Signature refused', { status: 401 });
  const event = JSON.parse(payload) as { id: string; data: { commit: string; tree: string; recoverableRef: string } };
  seen.push({ id, eventId: event.id, sequence: request.headers.get('webhook-sequence') ?? '', payload });
  db.transaction(() => {
    const previous = db.query('SELECT payload FROM inbox WHERE delivery_id=?').get(id) as { payload: string } | null;
    if (previous) { check(previous.payload === payload, 'Reused delivery changed payload'); duplicateReceipts++; return; }
    db.query('INSERT INTO inbox VALUES(?,?,?)').run(id, event.id, payload);
    db.query('INSERT OR IGNORE INTO actions VALUES(?,?,?,?)').run(event.id, event.data.commit, event.data.tree, event.data.recoverableRef);
  })();
  receipts++;
  // Receiver committed its side effect but sender gets a failed acknowledgement.
  return new Response(receipts === 1 ? 'Synthetic lost acknowledgement' : 'Recorded', { status: receipts === 1 ? 503 : 204 });
} });
try {
  const repository = join(root, 'repository');
  await commitGit(['init', '--initial-branch=main', repository]);
  await Bun.write(join(repository, 'source.txt'), 'Locally accepted test fixture\n');
  await commitGit(['-C', repository, 'add', '.']);
  await commitGit(['-C', repository, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Accepted local fixture']);
  const commit = await commitGit(['-C', repository, 'rev-parse', 'HEAD']);
  const tree = await commitGit(['-C', repository, 'rev-parse', 'HEAD^{tree}']);
  const ref = 'refs/flaregit/deployments/local-journal';
  await commitGit(['-C', repository, 'update-ref', ref, commit]);
  const payload = JSON.stringify({ id: 'evt_local-proof', type: 'deployment.requested', data: { commit, tree, recoverableRef: ref } });
  const deliveryId = 'dlv_local-proof';
  db.query('INSERT INTO delivery VALUES(?,?,?,?)').run(deliveryId, 'pending', 0, payload);
  const ledger = {
    getDelivery: async (id: string) => {
      const row = db.query('SELECT * FROM delivery WHERE id=?').get(id) as { id: string; status: string; attempts: number; payload: string } | null;
      return row ? { delivery: { ...row, seq: 1, generation: 0 }, webhook: { active: 1, url: 'https://receiver.fixture.example/webhook', secret: signingSecret } } : null;
    },
    isBlocked: async () => false,
    markDelivery: async (id: string, result: { ok: boolean; final?: boolean }) => {
      db.query("UPDATE delivery SET attempts=attempts+1,status=? WHERE id=? AND status!='success'").run(result.ok ? 'success' : result.final ? 'failed' : 'pending', id);
      return (db.query('SELECT attempts FROM delivery WHERE id=?').get(id) as { attempts: number }).attempts;
    },
  };
  const env = { REPOSITORY_CONTROLLER: { idFromName: (name: string) => name, get: () => ledger } } as unknown as Env;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    check(String(input) === 'https://receiver.fixture.example/webhook', 'Unexpected network destination');
    check(init?.redirect === 'manual', 'Production redirect fence changed');
    networkCalls++;
    return nativeFetch(`http://127.0.0.1:${server.port}/webhook`, init);
  }) as typeof fetch;
  check(await deliverWebhook(env, 'local-project', deliveryId) === 30, 'Failure must schedule first retry');
  check((db.query('SELECT status FROM delivery').get() as { status: string }).status === 'pending', 'Failed acknowledgement was mislabeled successful');
  // Restart durable storage before retry: consumer dedupe survives interruption.
  db.close(); db = new Database(path);
  check(await deliverWebhook(env, 'local-project', deliveryId) === null, 'Retry must finish');
  check((db.query('SELECT attempts FROM delivery').get() as { attempts: number }).attempts === 2, 'Retry attempts missing');
  check(await deliverWebhook(env, 'local-project', deliveryId) === null && networkCalls === 2, 'Terminal duplicate queue message dispatched again');
  // Same durable reset used by explicit owner redelivery; no new event/delivery.
  db.query("UPDATE delivery SET status='pending',attempts=0 WHERE id=?").run(deliveryId);
  check(await deliverWebhook(env, 'local-project', deliveryId) === null, 'Explicit replay must finish');
  check(networkCalls === 3 && duplicateReceipts === 2, 'Retry and replay must reach consumer as recognizable duplicates');
  check(seen.every(row => row.id === deliveryId && row.eventId === 'evt_local-proof' && row.sequence === '1' && row.payload === payload), 'Replay identity or payload changed');
  check((db.query('SELECT COUNT(*) AS n FROM inbox').get() as { n: number }).n === 1, 'Consumer inbox duplicated');
  check((db.query('SELECT COUNT(*) AS n FROM actions').get() as { n: number }).n === 1, 'Semantic deployment action duplicated');
  await Bun.write(join(repository, 'source.txt'), 'Later local fixture\n');
  await commitGit(['-C', repository, 'add', '.']);
  await commitGit(['-C', repository, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Later local fixture']);
  check(await commitGit(['-C', repository, 'rev-parse', 'HEAD']) !== commit, 'Fixture did not advance current history');
  check(await commitGit(['-C', repository, 'rev-parse', ref]) === commit, 'Recorded deployment commit was lost');
  check(await commitGit(['-C', repository, 'rev-parse', `${ref}^{tree}`]) === tree, 'Recovered deployment tree differs');
  console.log(JSON.stringify({ evidence: 'local-only', signedReceipts: receipts, duplicates: duplicateReceipts, semanticActions: 1, retainedCommitRecovered: true }));
} finally {
  globalThis.fetch = nativeFetch;
  server.stop(true);
  db.close();
  await rm(root, { recursive: true, force: true });
}
