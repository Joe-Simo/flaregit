import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import {C02NetworkReceiverLedger,C02NetworkReceiverSqlStore} from '../../src/server/c02-network-receiver';
import {createC02NetworkReceiverHttpHandler} from '../../src/server/c02-network-receiver-http';

interface ReceiverEnv {
  RECEIPTS: DurableObjectNamespace<DeliveryReceipts>;
  NETWORK_RECEIPTS?: DurableObjectNamespace<NetworkReceipts>;
  WEBHOOK_SECRET: string;
  CONTROL_SECRET: string;
  C02_RECEIVER_CONTROL_SECRET?:string;
  EXPECTED_PROJECT: string;
}
const sha = z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/);
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const eventSchema = z.object({
  id, type: z.literal('deployment.requested'),
  project: z.object({ id: z.string().regex(/^[a-z0-9]{12,16}$/) }),
  data: z.object({ commit: sha, tree: sha, recoverableRef: z.string().max(300).regex(/^refs\/flaregit\/deployments\/[A-Za-z0-9_-]+$/) }),
});
const modes = ['fail-once-after-commit', 'fail-always-after-commit', 'healthy'] as const;
type Mode = typeof modes[number];
const bytes = new TextEncoder();
async function digest(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.encode(value))), v => v.toString(16).padStart(2, '0')).join(''); }
async function controlAllowed(request: Request, env: ReceiverEnv) {
  const supplied = /^Bearer ([^\s]{32,512})$/.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!supplied || !env.CONTROL_SECRET || env.CONTROL_SECRET.length < 32 || env.CONTROL_SECRET.length > 512) return false;
  // Delegate MAC comparison to Web Crypto verification instead of comparing
  // secret strings or digest strings with JavaScript equality.
  const algorithm = { name: 'HMAC', hash: 'SHA-256' };
  const expectedKey = await crypto.subtle.importKey('raw', bytes.encode(env.CONTROL_SECRET), algorithm, false, ['verify']);
  const suppliedKey = await crypto.subtle.importKey('raw', bytes.encode(supplied), algorithm, false, ['sign']);
  const challenge = bytes.encode('flaregit-owned-delivery-control-v1');
  return crypto.subtle.verify('HMAC', expectedKey, await crypto.subtle.sign('HMAC', suppliedKey, challenge), challenge);
}
async function readBounded(request: Request): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > 65_536) { await reader.cancel(); return null; } chunks.push(value);
    }
    const result = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder('utf-8', { fatal: true }).decode(result);
  } catch { return null; } finally { reader.releaseLock(); }
}
async function validSignature(request: Request, payload: string, env: ReceiverEnv): Promise<boolean> {
  const deliveryId = request.headers.get('webhook-id'), timestamp = request.headers.get('webhook-timestamp'), signatures = request.headers.get('webhook-signature');
  if (!deliveryId || !/^dlv_[a-z0-9-]{1,128}$/.test(deliveryId) || !timestamp || !/^\d{1,16}$/.test(timestamp) || !signatures || signatures.length > 1024) return false;
  if (!Number.isSafeInteger(Number(timestamp)) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  try {
    const raw = atob(env.WEBHOOK_SECRET.replace(/^whsec_/, '')); if (raw.length < 24) return false;
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(raw, v => v.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    for (const signature of signatures.split(' ')) {
      if (!signature.startsWith('v1,')) continue;
      const decoded = Uint8Array.from(atob(signature.slice(3)), v => v.charCodeAt(0));
      if (await crypto.subtle.verify('HMAC', key, decoded, bytes.encode(`${deliveryId}.${timestamp}.${payload}`))) return true;
    }
  } catch { return false; }
  return false;
}

export class DeliveryReceipts extends DurableObject<ReceiverEnv> {
  constructor(ctx: DurableObjectState, env: ReceiverEnv) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,event_id TEXT NOT NULL,payload_hash TEXT NOT NULL,sequence TEXT NOT NULL,receipts INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS actions(event_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,commit_sha TEXT NOT NULL,tree_sha TEXT NOT NULL,ref TEXT NOT NULL); CREATE TABLE IF NOT EXISTS policy(id INTEGER PRIMARY KEY CHECK(id=1),mode TEXT NOT NULL,failure_consumed INTEGER NOT NULL); INSERT OR IGNORE INTO policy VALUES(1,\'fail-once-after-commit\',0);');
  }
  receive(input: { deliveryId: string; eventId: string; payloadHash: string; sequence: string; commit: string; tree: string; ref: string }) {
    return this.ctx.storage.transactionSync(() => {
      const previous = this.ctx.storage.sql.exec<{ payload_hash: string }>('SELECT payload_hash FROM deliveries WHERE id=?', input.deliveryId).toArray()[0];
      const action = this.ctx.storage.sql.exec<{ payload_hash: string }>('SELECT payload_hash FROM actions WHERE event_id=?', input.eventId).toArray()[0];
      if ((previous && previous.payload_hash !== input.payloadHash) || (action && action.payload_hash !== input.payloadHash)) return 409;
      if (!previous && this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM deliveries').toArray()[0]!.n >= 100) return 429;
      if (previous) this.ctx.storage.sql.exec('UPDATE deliveries SET receipts=receipts+1 WHERE id=?', input.deliveryId);
      else this.ctx.storage.sql.exec('INSERT INTO deliveries VALUES(?,?,?,?,1)', input.deliveryId, input.eventId, input.payloadHash, input.sequence);
      if (!action) this.ctx.storage.sql.exec('INSERT INTO actions VALUES(?,?,?,?,?)', input.eventId, input.payloadHash, input.commit, input.tree, input.ref);
      const policy = this.ctx.storage.sql.exec<{ mode: Mode; failure_consumed: number }>('SELECT mode,failure_consumed FROM policy WHERE id=1').toArray()[0]!;
      if (policy.mode === 'fail-always-after-commit' || (policy.mode === 'fail-once-after-commit' && !policy.failure_consumed)) {
        this.ctx.storage.sql.exec('UPDATE policy SET failure_consumed=1 WHERE id=1'); return 503;
      }
      return 204;
    });
  }
  setMode(mode: Mode) { this.ctx.storage.sql.exec('UPDATE policy SET mode=?,failure_consumed=0 WHERE id=1', mode); }
  report() {
    return { evidence: 'owned-receiver-only', deploymentExecuted: false, deliveries: this.ctx.storage.sql.exec('SELECT id,event_id,payload_hash,sequence,receipts FROM deliveries ORDER BY id').toArray(), actions: this.ctx.storage.sql.exec('SELECT event_id,commit_sha,tree_sha,ref FROM actions ORDER BY event_id').toArray() };
  }
}
/** Separate fixed C02 ledger; it never reads or changes webhook delivery state. */
export class NetworkReceipts extends DurableObject<ReceiverEnv> {
  override async fetch(request:Request){
    const ledger=new C02NetworkReceiverLedger(new C02NetworkReceiverSqlStore({
      transactionSync:operation=>this.ctx.storage.transactionSync(operation),
      exec:(query,...bindings)=>this.ctx.storage.sql.exec(query,...bindings),
    }));
    return createC02NetworkReceiverHttpHandler({ledger,receiverId:'flaregit-owned-network-v1',authorizeOperator:request=>controlAllowed(request,{...this.env,CONTROL_SECRET:this.env.C02_RECEIVER_CONTROL_SECRET??''})})(request);
  }
}
export default {
  async fetch(request: Request, env: ReceiverEnv) {
    const route = new URL(request.url).pathname;
    if(route.startsWith('/c02-network/')){
      if(!env.NETWORK_RECEIPTS)return new Response('Network receiver not configured',{status:503,headers:{'Cache-Control':'no-store'}});
      return env.NETWORK_RECEIPTS.getByName('fixed-c02-network-v1').fetch(request);
    }
    if (!/^[a-z0-9]{12,16}$/.test(env.EXPECTED_PROJECT ?? '')) return new Response('Receiver not configured', { status: 503 });
    if (route === '/report' || route === '/mode') {
      if (!await controlAllowed(request, env)) return new Response('Unauthorized', { status: 401 });
      const ledger = env.RECEIPTS.getByName(env.EXPECTED_PROJECT);
      if (route === '/report' && request.method === 'GET') return Response.json(await ledger.report(), { headers: { 'Cache-Control': 'no-store' } });
      if (route === '/mode' && request.method === 'POST') {
        const body = await readBounded(request); let mode: unknown;
        try { mode = JSON.parse(body ?? '').mode; } catch { return new Response('Invalid mode', { status: 400 }); }
        if (!modes.includes(mode as Mode)) return new Response('Invalid mode', { status: 400 });
        await ledger.setMode(mode as Mode); return Response.json({ mode });
      }
      return new Response('Method not allowed', { status: 405 });
    }
    if (route !== '/webhook' || request.method !== 'POST') return new Response('Not found', { status: 404 });
    const body = await readBounded(request); if (body === null) return new Response('Invalid body', { status: 413 });
    if (!await validSignature(request, body, env)) return new Response('Unauthorized', { status: 401 });
    let parsed: unknown; try { parsed = JSON.parse(body); } catch { return new Response('Invalid event', { status: 400 }); }
    const event = eventSchema.safeParse(parsed); if (!event.success || event.data.project.id !== env.EXPECTED_PROJECT) return new Response('Event scope refused', { status: 403 });
    const sequence = request.headers.get('webhook-sequence') ?? '';
    if (!/^\d{1,16}$/.test(sequence) || !Number.isSafeInteger(Number(sequence)) || Number(sequence) < 1) return new Response('Invalid sequence', { status: 400 });
    const status = await env.RECEIPTS.getByName(env.EXPECTED_PROJECT).receive({ deliveryId: request.headers.get('webhook-id')!, eventId: event.data.id, payloadHash: await digest(body), sequence, commit: event.data.data.commit, tree: event.data.data.tree, ref: event.data.data.recoverableRef });
    return new Response(null, { status });
  },
};
