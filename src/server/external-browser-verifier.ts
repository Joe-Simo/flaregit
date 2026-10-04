import { z } from 'zod';
import { verifyBuildManifest, type BuildFile, type BuildManifest, type StaticBuildScope } from './static-build-artifact';

const selector = z.string().min(1).max(256);
const path = z.string().regex(/^\/[a-zA-Z0-9_./-]*$/).max(256).refine(value => !value.split('/').some(part => part === '..' || part === '.'));
const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), path }).strict(),
  z.object({ kind: z.literal('click'), selector }).strict(),
  z.object({ kind: z.literal('fill'), selector, value: z.string().max(4096) }).strict(),
  z.object({ kind: z.literal('select'), selector, value: z.string().max(4096) }).strict(),
]);
const primitiveQuerySchema = z.union([
  z.object({ kind: z.enum(['text', 'value', 'visible', 'count']), selector }).strict(),
  z.object({ kind: z.literal('attribute'), selector, attribute: z.literal('data-event-id') }).strict(),
]);
const querySchema = z.union([primitiveQuerySchema, z.object({ kind: z.literal('texts'), selector, maxRows: z.number().int().min(1).max(64) }).strict()]);
const primitiveAssertionSchema = z.object({ query: primitiveQuerySchema, expected: z.union([z.string().max(16384), z.boolean(), z.number().int().min(0).max(10000)]) }).strict().refine(value => value.query.kind === 'visible' ? typeof value.expected === 'boolean' : value.query.kind === 'count' ? typeof value.expected === 'number' : typeof value.expected === 'string');
const receiptAssertionSchema = z.object({ kind: z.literal('receipt-sum'), containerSelector: selector, rowsSelector: selector, totalSelector: selector, totalPrefix: z.string().max(32), optional: z.boolean(), maxRows: z.number().int().min(1).max(64) }).strict();
const assertionSchema = z.union([primitiveAssertionSchema, receiptAssertionSchema]);
const policySchema = z.object({ version: z.literal(1), deadlineMs: z.number().int().min(100).max(120000), cases: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), actions: z.array(actionSchema).min(1).max(32).refine(actions => actions[0]?.kind === 'navigate'), assertions: z.array(assertionSchema).min(1).max(32) }).strict()).min(1).max(32) }).strict().refine(value => new Set(value.cases.map(item => item.id)).size === value.cases.length);
export type BrowserPolicy = z.infer<typeof policySchema>;
export type BrowserAction = z.infer<typeof actionSchema>;
export type BrowserQuery = z.infer<typeof querySchema>;
export type BrowserObservation = string | boolean | number | string[];
export interface BrowserRequest { url: string; method: string; redirected: boolean; serviceWorker: boolean; resourceType: string }
export type BrowserResponse = { status: 200; headers: Record<string, string>; bytes: Uint8Array } | { abort: true };
export interface BrowserVerificationTransport {
  /** Fresh isolated context; interception installed before any page exists. No credentials, cookies,
   * cache or storage carried from other leases. Workers, WebSockets, downloads and popups disabled.
   * close MUST also cancel/settle allocation if its promise is pending or has failed. */
  allocate(options: { leaseId: string; origin: string; signal: AbortSignal; isolation: 'fresh-no-credentials'; intercept: (request: BrowserRequest) => Promise<BrowserResponse> }): Promise<void>;
  act(leaseId: string, action: BrowserAction, signal: AbortSignal): Promise<void>;
  observe(leaseId: string, query: BrowserQuery, signal: AbortSignal): Promise<BrowserObservation>;
  /** Positive receipt means all pages, contexts and pending operations for this lease are gone. */
  close(leaseId: string): Promise<{ leaseId: string; closed: boolean }>;
}
export interface BrowserVerificationReceipt {
  version: 1; scope: StaticBuildScope; sourceDigest: string; buildDigest: string; policyDigest: string;
  cases: Array<{ id: string; assertions: number; passed: true }>; cleanup: 'confirmed';
}
async function sha(value: unknown) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join(''); }
/** Policy must come from the trusted requirement inventory, never candidate files or stdout. */
export async function bindBrowserPolicy(input: BrowserPolicy) { const policy = policySchema.parse(input); return { policy, digest: await sha(policy) }; }
const mime: Record<string, string> = { html: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf' };
async function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted(); let abort = () => {};
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { abort = () => reject(Error('Browser verification deadline')); signal.addEventListener('abort', abort, { once: true }); })]); }
  finally { signal.removeEventListener('abort', abort); }
}
/** Candidate JS executes solely in the external browser. This Worker serves immutable bytes,
 * sends trusted actions, reads bounded primitives and performs every expected comparison itself. */
export async function verifyExternalBrowser(input: {
  scope: StaticBuildScope; source: BuildManifest; sourceFiles: readonly BuildFile[];
  output: BuildManifest; outputFiles: readonly BuildFile[]; policy: BrowserPolicy;
  transport: BrowserVerificationTransport; authorize: () => Promise<void>; budget: () => Promise<void>;
  onExpectedFailure?: (failure: { caseId: string }) => Promise<void>;
}): Promise<BrowserVerificationReceipt> {
  const onExpectedFailure = input.onExpectedFailure;
  const scope = structuredClone(input.scope), source = structuredClone(input.source), output = structuredClone(input.output);
  const sourceFiles = input.sourceFiles.map(file => ({ ...file, bytes: file.bytes.slice() }));
  const outputFiles = input.outputFiles.map(file => ({ ...file, bytes: file.bytes.slice() }));
  const { policy, digest } = await bindBrowserPolicy(input.policy);
  if (scope.policyDigest !== digest || source.kind !== 'source' || output.kind !== 'static') throw Error('Trusted browser policy identity differs');
  await verifyBuildManifest(source, scope, sourceFiles);
  await verifyBuildManifest(output, scope, outputFiles, source.digest);
  const signal = AbortSignal.timeout(policy.deadlineMs);
  const fresh = async () => { signal.throwIfAborted(); await bounded(input.authorize(), signal); signal.throwIfAborted(); await bounded(input.budget(), signal); signal.throwIfAborted(); };
  const assets = new Map(outputFiles.map(file => [file.path, file.bytes]));
  const cases: BrowserVerificationReceipt['cases'] = [];
  for (const testCase of policy.cases) {
    await fresh();
    const leaseId = crypto.randomUUID();
    const origin = `https://${leaseId}.verification.invalid`;
    let denied = false, active = true;
    const intercept = async (request: BrowserRequest): Promise<BrowserResponse> => {
      if (!active) { denied = true; return { abort: true }; }
      try { await fresh(); } catch { denied = true; return { abort: true }; }
      if (!active) { denied = true; return { abort: true }; }
      let url: URL; try { url = new URL(request.url); } catch { denied = true; return { abort: true }; }
      const assetPath = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const bytes = assets.get(assetPath);
      if (request.method !== 'GET' || request.redirected || request.serviceWorker || ['websocket', 'eventsource', 'worker', 'serviceworker'].includes(request.resourceType) || url.origin !== origin || url.username || url.password || url.search || url.hash || !bytes || /[%\\]/.test(url.pathname) || request.url !== origin + url.pathname) { denied = true; return { abort: true }; }
      return { status: 200, bytes: bytes.slice(), headers: { 'content-type': mime[assetPath.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts allow-same-origin", 'x-content-type-options': 'nosniff' } };
    };
    try {
      await bounded(input.transport.allocate({ leaseId, origin, signal, isolation: 'fresh-no-credentials', intercept }), signal);
      await fresh();
      for (const action of testCase.actions) {
        await fresh(); await bounded(input.transport.act(leaseId, structuredClone(action), signal), signal); await fresh();
        if (denied) throw Error('Browser requested disallowed traffic');
      }
      const observe = async (query: BrowserQuery) => { await fresh(); const value = await bounded(input.transport.observe(leaseId, structuredClone(querySchema.parse(query)), signal), signal); await fresh(); if (denied) throw Error('Browser requested disallowed traffic'); return value; };
      for (const assertion of testCase.assertions) {
        if ('kind' in assertion) {
          const present = await observe({ kind: 'count', selector: assertion.containerSelector });
          if (present === 0 && assertion.optional) continue;
          if (present !== 1) throw Error('Receipt container presence differs');
          const count = await observe({ kind: 'count', selector: assertion.rowsSelector });
          if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > assertion.maxRows) throw Error('Receipt row bound exceeded');
          const rows = z.array(z.string().max(32)).max(assertion.maxRows).parse(await observe({ kind: 'texts', selector: assertion.rowsSelector, maxRows: assertion.maxRows }));
          if (rows.length !== count) throw Error('Receipt row inventory differs');
          const total = await observe({ kind: 'text', selector: assertion.totalSelector });
          if (typeof total !== 'string' || !total.startsWith(assertion.totalPrefix)) throw Error('Receipt total format differs');
          const expected = parseBrowserMoney(total.slice(assertion.totalPrefix.length));
          let sum = 0;
          for (const row of rows) { sum += parseBrowserMoney(row); if (!Number.isSafeInteger(sum) || Math.abs(sum) > MAX_MONEY_CENTS) throw Error('Receipt sum bound exceeded'); }
          if (sum !== expected) throw Error(`Browser receipt sum failed: ${testCase.id}`);
        } else {
          const observed = await observe(assertion.query);
          if (typeof observed !== typeof assertion.expected) throw Error('Browser primitive observation type differs');
          z.union([z.string().max(16384), z.boolean(), z.number().int().min(0).max(10000)]).parse(observed);
          if (observed !== assertion.expected) {
            await fresh();
            try {
              if (onExpectedFailure) { await bounded(onExpectedFailure({ caseId: testCase.id }), signal); await fresh(); }
            } finally { throw Error(`Browser expected check failed: ${testCase.id}`); }
          }
        }
      }
    } finally {
      active = false;
      const closed = await bounded(input.transport.close(leaseId), AbortSignal.timeout(10000));
      if (closed.leaseId !== leaseId || closed.closed !== true) throw Error('Browser cleanup remains unconfirmed');
    }
    await fresh(); if (denied) throw Error('Browser requested disallowed traffic');
    cases.push({ id: testCase.id, assertions: testCase.assertions.length, passed: true });
  }
  await fresh();
  return { version: 1, scope, sourceDigest: source.digest, buildDigest: output.digest, policyDigest: digest, cases, cleanup: 'confirmed' };
}

const MAX_MONEY_CENTS = 1000000000;
/** Strict decimal display parser. Currency arithmetic lives in the Worker, never the page. */
export function parseBrowserMoney(value: string): number {
  const match = /^(-)?\$(0|[1-9][0-9]{0,7})\.([0-9]{2})$/.exec(value);
  if (!match) throw Error('Invalid browser currency');
  const cents = Number(match[2]) * 100 + Number(match[3]);
  if (!Number.isSafeInteger(cents) || cents > MAX_MONEY_CENTS) throw Error('Browser currency bound exceeded');
  return match[1] && cents !== 0 ? -cents : cents;
}
