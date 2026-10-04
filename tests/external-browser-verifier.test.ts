import { expect, test } from 'bun:test';
import { bindBuildManifest } from '../src/server/static-build-artifact';
import { bindBrowserPolicy, verifyExternalBrowser, parseBrowserMoney, type BrowserObservation, type BrowserPolicy, type BrowserVerificationTransport, type BrowserRequest, type BrowserResponse } from '../src/server/external-browser-verifier';

// Deliberately synthetic transport tests: no Chromium or Cloudflare hosted proof.
const policy: BrowserPolicy = { version: 1, deadlineMs: 1000, cases: [{ id: 'title', actions: [{ kind: 'navigate', path: '/' }], assertions: [{ query: { kind: 'text', selector: 'h1' }, expected: 'Approved' }] }] };
async function fixture(transport: BrowserVerificationTransport, selected = policy) {
  const bound = await bindBrowserPolicy(selected);
  const scope = { attemptId: '11111111-1111-4111-8111-111111111111', projectId: 'abcdefghijkl', incarnation: '22222222-2222-4222-8222-222222222222', commit: 'a'.repeat(40), tree: 'b'.repeat(40), policyDigest: bound.digest };
  const sourceFiles = [{ path: 'index.html', kind: 'file' as const, bytes: new TextEncoder().encode('<h1>Approved</h1>') }];
  const source = await bindBuildManifest('source', scope, sourceFiles);
  const outputFiles = sourceFiles.map(file => ({ ...file, bytes: file.bytes.slice() }));
  const output = await bindBuildManifest('static', scope, outputFiles, source.digest);
  return { scope, source, sourceFiles, output, outputFiles, policy: selected, transport, authorize: async () => {}, budget: async () => {} };
}
function synthetic() {
  const allocations: Array<Parameters<BrowserVerificationTransport['allocate']>[0]> = [];
  const closed: string[] = [];
  const transport: BrowserVerificationTransport = {
    async allocate(options) { allocations.push(options); }, async act() {}, async observe() { return 'Approved'; },
    async close(leaseId) { closed.push(leaseId); return { leaseId, closed: true }; },
  };
  return { transport, allocations, closed };
}
test('synthetic: receipts derive from independently bound trusted inventory and confirmed cleanup', async () => {
  const fake = synthetic(); const input = await fixture(fake.transport); const receipt = await verifyExternalBrowser(input);
  expect(receipt.cases).toEqual([{ id: 'title', assertions: 1, passed: true }]);
  expect(receipt.buildDigest).toBe(input.output.digest); expect(receipt.policyDigest).toBe(input.scope.policyDigest);
  expect(fake.closed).toEqual([fake.allocations[0]!.leaseId]);
});
test('synthetic: candidate output, source and trusted policy tampering cannot allocate a browser', async () => {
  for (const target of ['source', 'output', 'policy'] as const) {
    const fake = synthetic(); const input = await fixture(fake.transport);
    if (target === 'policy') input.policy = { ...policy, cases: [{ ...policy.cases[0]!, id: 'weakened' }] };
    else input[target].digest = 'c'.repeat(64);
    await expect(verifyExternalBrowser(input)).rejects.toThrow(); expect(fake.allocations).toHaveLength(0);
  }
});
test('synthetic: page success strings are compared against expectations, never trusted as reports', async () => {
  const fake = synthetic(); fake.transport.observe = async () => 'passed';
  await expect(verifyExternalBrowser(await fixture(fake.transport))).rejects.toThrow('expected check failed'); expect(fake.closed).toHaveLength(1);
});
test('synthetic: traffic serves exact immutable bytes and denies external, redirect, service-worker and unknown traffic', async () => {
  const fake = synthetic(); let served: BrowserResponse | undefined;
  fake.transport.act = async () => { const options = fake.allocations[0]!; served = await options.intercept({ url: options.origin + '/', method: 'GET', redirected: false, serviceWorker: false, resourceType: 'document' }); };
  await verifyExternalBrowser(await fixture(fake.transport));
  expect(served && 'bytes' in served ? new TextDecoder().decode(served.bytes) : '').toBe('<h1>Approved</h1>');
  for (const patch of [{ url: 'https://example.com/' }, { redirected: true }, { serviceWorker: true }, { method: 'POST' }, { path: '/missing.js' }, { path: '/?secret=x' }, { resourceType: 'websocket' }, { path: '/%69ndex.html' }] ) {
    const denied = synthetic();
    denied.transport.act = async () => {
      const options = denied.allocations[0]!;
      const request: BrowserRequest = { url: options.origin + ('path' in patch ? patch.path : '/'), method: 'GET', redirected: false, serviceWorker: false, resourceType: 'document', ...patch };
      expect(await options.intercept(request)).toEqual({ abort: true });
    };
    await expect(verifyExternalBrowser(await fixture(denied.transport))).rejects.toThrow('disallowed traffic'); expect(denied.closed).toHaveLength(1);
  }
});
test('synthetic: revocation after awaited action prevents observation and still closes', async () => {
  const fake = synthetic(); let revoked = false, observations = 0;
  fake.transport.act = async () => { revoked = true; }; fake.transport.observe = async () => { observations++; return 'Approved'; };
  const input = await fixture(fake.transport); input.authorize = async () => { if (revoked) throw Error('revoked'); };
  await expect(verifyExternalBrowser(input)).rejects.toThrow('revoked'); expect(observations).toBe(0); expect(fake.closed).toHaveLength(1);
});
test('synthetic: exhausted budget before allocation and unconfirmed cleanup block acceptance', async () => {
  const fake = synthetic(); const input = await fixture(fake.transport); input.budget = async () => { throw Error('budget'); };
  await expect(verifyExternalBrowser(input)).rejects.toThrow('budget'); expect(fake.allocations).toHaveLength(0);
  const other = synthetic(); other.transport.close = async leaseId => ({ leaseId, closed: false });
  await expect(verifyExternalBrowser(await fixture(other.transport))).rejects.toThrow('cleanup remains unconfirmed');
});
test('synthetic: deadline on pending allocation invokes lease cleanup and cannot issue actions', async () => {
  const fake = synthetic(); let actions = 0;
  fake.transport.allocate = async options => { fake.allocations.push(options); await new Promise<void>(() => {}); };
  fake.transport.act = async () => { actions++; };
  await expect(verifyExternalBrowser(await fixture(fake.transport, { ...policy, deadlineMs: 100 }))).rejects.toThrow('deadline');
  expect(actions).toBe(0); expect(fake.closed).toHaveLength(1);
});
test('synthetic: each case has a fresh origin and isolated lease', async () => {
  const fake = synthetic(); await verifyExternalBrowser(await fixture(fake.transport, { ...policy, cases: [...policy.cases, { ...policy.cases[0]!, id: 'second' }] }));
  expect(fake.allocations).toHaveLength(2); expect(fake.allocations[0]!.origin).not.toBe(fake.allocations[1]!.origin); expect(fake.closed).toHaveLength(2);
});
test('synthetic: intercepted authority failure fails closed even if transport swallows the denial', async () => {
  const fake = synthetic(); let revoked = false;
  fake.transport.act = async () => {
    revoked = true; const options = fake.allocations[0]!;
    expect(await options.intercept({ url: options.origin + '/', method: 'GET', redirected: false, serviceWorker: false, resourceType: 'document' })).toEqual({ abort: true });
    revoked = false;
  };
  const input = await fixture(fake.transport); input.authorize = async () => { if (revoked) throw Error('revoked'); };
  await expect(verifyExternalBrowser(input)).rejects.toThrow('disallowed traffic'); expect(fake.closed).toHaveLength(1);
});
test('synthetic: sealed bytes survive caller mutation and completed interception cannot serve again', async () => {
  const fake = synthetic(); const input = await fixture(fake.transport);
  fake.transport.act = async () => {
    input.outputFiles[0]!.bytes.fill(0);
    const options = fake.allocations[0]!;
    const response = await options.intercept({ url: options.origin + '/', method: 'GET', redirected: false, serviceWorker: false, resourceType: 'document' });
    expect('bytes' in response ? new TextDecoder().decode(response.bytes) : '').toBe('<h1>Approved</h1>');
  };
  await verifyExternalBrowser(input);
  const options = fake.allocations[0]!;
  expect(await options.intercept({ url: options.origin + '/', method: 'GET', redirected: false, serviceWorker: false, resourceType: 'document' })).toEqual({ abort: true });
});

test('synthetic: trusted select action is bound to inventory and its value observation must match', async () => {
  const selected: BrowserPolicy = { ...policy, cases: [{ id: 'shipping', actions: [{ kind: 'navigate', path: '/' }, { kind: 'select', selector: '#shipping-speed-select', value: 'express' }], assertions: [{ query: { kind: 'value', selector: '#shipping-speed-select' }, expected: 'express' }] }] };
  for (const observation of ['express', 'standard']) {
    const fake = synthetic(); const actions: unknown[] = [];
    fake.transport.act = async (_id, action) => { actions.push(action); }; fake.transport.observe = async () => observation;
    const input = await fixture(fake.transport, selected);
    if (observation === 'express') expect((await verifyExternalBrowser(input)).cases).toEqual([{ id: 'shipping', assertions: 1, passed: true }]);
    else await expect(verifyExternalBrowser(input)).rejects.toThrow('expected check failed');
    expect(actions).toEqual(selected.cases[0]!.actions); expect(fake.closed).toHaveLength(1);
  }
});

test('synthetic: Worker currency parsing is exact and rejects malicious decimals/nonfinite/overflow', () => {
  expect(parseBrowserMoney('$0.10') + parseBrowserMoney('$0.20')).toBe(30); expect(parseBrowserMoney('-$4.25')).toBe(-425);
  for (const value of ['$NaN', '$Infinity', '$1e3', '$1.001', '$01.00', '$-1.00', ' $1.00', '$1.00\n', '$100000000000000000000.00', '$10000000.01']) expect(() => parseBrowserMoney(value)).toThrow();
});
const receiptPolicy: BrowserPolicy = { ...policy, cases: [{ id: 'receipt', actions: [{ kind: 'navigate', path: '/' }], assertions: [{ kind: 'receipt-sum', containerSelector: '#receipt', rowsSelector: '#receipt [data-receipt-amount]', totalSelector: '#total', totalPrefix: 'Total: ', optional: true, maxRows: 64 }] }] };
async function receiptInput(values: { presence?: number; count?: number; rows?: unknown; total?: unknown }) {
  const fake = synthetic();
  fake.transport.observe = async (_id, query): Promise<BrowserObservation> => {
    if (query.kind === 'count') return query.selector === '#receipt' ? values.presence ?? 1 : values.count ?? 2;
    if (query.kind === 'texts') return (values.rows ?? ['$30.00', '$15.00']) as BrowserObservation;
    return (values.total ?? 'Total: $45.00') as BrowserObservation;
  };
  return { fake, input: await fixture(fake.transport, receiptPolicy) };
}
test('synthetic: Worker reconciles raw receipt rows, permits absent receipt, rejects present empty nonzero receipt', async () => {
  for (const values of [{}, { presence: 0 }, { count: 3, rows: ['$30.00', '$19.00', '-$4.00'] }]) {
    const { input } = await receiptInput(values); expect((await verifyExternalBrowser(input)).cases).toEqual([{ id: 'receipt', assertions: 1, passed: true }]);
  }
  const { input, fake } = await receiptInput({ count: 0, rows: [] });
  await expect(verifyExternalBrowser(input)).rejects.toThrow('receipt sum failed'); expect(fake.closed).toHaveLength(1);
});
test('synthetic: Worker rejects omitted/added receipt rows, malformed observations and count/text bounds', async () => {
  for (const values of [{ count: 2, rows: ['$45.00'] }, { count: 1, rows: ['$30.00', '$15.00'] }, { count: 65 }, { count: 1, rows: ['x'.repeat(33)] }, { count: 1, rows: [NaN] }, { count: 1, rows: { passed: true, sum: 45 } }, { count: Infinity }, { presence: 2 }]) {
    const { input, fake } = await receiptInput(values); await expect(verifyExternalBrowser(input)).rejects.toThrow(); expect(fake.closed).toHaveLength(1);
  }
});
test('synthetic: receipt sum never trusts candidate aggregate or permissive number parsing', async () => {
  for (const values of [{ rows: ['$30.00', '$15.001'] }, { rows: ['$30.00', '$NaN'] }, { rows: ['$9000000.00', '$9000000.00'] }, { total: Infinity }, { total: 'Total: $45.00 malicious' }]) {
    const { input, fake } = await receiptInput(values); await expect(verifyExternalBrowser(input)).rejects.toThrow(); expect(fake.closed).toHaveLength(1);
  }
});
test('synthetic: event identity is a whitelisted attribute expectation bound into trusted policy', async () => {
  const selected: BrowserPolicy = { ...policy, cases: [{ ...policy.cases[0]!, assertions: [{ query: { kind: 'attribute', selector: '#event', attribute: 'data-event-id' }, expected: 'cf-connect-2026' }] }] };
  for (const observation of ['cf-connect-2026', 'different-event']) {
    const fake = synthetic(); fake.transport.observe = async () => observation; const input = await fixture(fake.transport, selected);
    if (observation === 'cf-connect-2026') expect((await verifyExternalBrowser(input)).cases).toHaveLength(1);
    else await expect(verifyExternalBrowser(input)).rejects.toThrow('expected check failed');
  }
});
test('synthetic: trusted mismatch callback receives only immutable case identity before failed cleanup', async () => {
  const fake = synthetic(); fake.transport.observe = async () => 'wrong'; fake.transport.close = async leaseId => ({ leaseId, closed: false });
  const input = await fixture(fake.transport); const failures: unknown[] = [];
  const callbackInput = { ...input, onExpectedFailure: async (failure: { caseId: string }) => { failures.push(failure); } };
  const allocation = fake.transport.allocate;
  fake.transport.allocate = async options => { callbackInput.onExpectedFailure = async () => { throw Error('mutated caller callback'); }; await allocation(options); };
  await expect(verifyExternalBrowser(callbackInput)).rejects.toThrow('cleanup remains unconfirmed');
  expect(failures).toEqual([{ caseId: 'title' }]);
});
test('synthetic: authority or budget withdrawn immediately before mismatch recording prevents callback', async () => {
  for (const mode of ['authority', 'budget']) {
    const fake = synthetic(); let observed = false, rechecks = 0, calls = 0;
    fake.transport.observe = async () => { observed = true; return 'wrong'; };
    const input = await fixture(fake.transport);
    const guarded = async () => { if (observed && ++rechecks === 2) throw Error('withdrawn'); };
    if (mode === 'authority') input.authorize = guarded; else input.budget = guarded;
    await expect(verifyExternalBrowser({ ...input, onExpectedFailure: async () => { calls++; } })).rejects.toThrow('withdrawn');
    expect(calls).toBe(0); expect(fake.closed).toHaveLength(1);
  }
});
test('synthetic: denied traffic cannot trigger mismatch recording even when observation would differ', async () => {
  const fake = synthetic(); let calls = 0;
  fake.transport.act = async () => { const options = fake.allocations[0]!; await options.intercept({ url: 'https://external.invalid/', method: 'GET', redirected: false, serviceWorker: false, resourceType: 'document' }); };
  fake.transport.observe = async () => 'wrong';
  await expect(verifyExternalBrowser({ ...await fixture(fake.transport), onExpectedFailure: async () => { calls++; } })).rejects.toThrow('disallowed traffic');
  expect(calls).toBe(0); expect(fake.closed).toHaveLength(1);
});
test('synthetic: durable mismatch callback is deadline bounded and its error cannot leak page data or grant acceptance', async () => {
  const fake = synthetic(); fake.transport.observe = async () => 'wrong';
  const input = await fixture(fake.transport, { ...policy, deadlineMs: 100 });
  await expect(verifyExternalBrowser({ ...input, onExpectedFailure: async () => new Promise<void>(() => {}) })).rejects.toThrow('Browser expected check failed: title');
  expect(fake.closed).toHaveLength(1);
  const other = synthetic(); other.transport.observe = async () => 'wrong';
  await expect(verifyExternalBrowser({ ...await fixture(other.transport), onExpectedFailure: async () => { throw Error('secret callback body'); } })).rejects.toThrow('Browser expected check failed: title');
});

test('synthetic: malformed transport observations cannot be persisted as known primitive comparison failures', async () => {
  for (const observation of [['candidate-report'], true, Infinity, 'x'.repeat(16385)] satisfies BrowserObservation[]) {
    const fake = synthetic(); let calls = 0; fake.transport.observe = async () => observation;
    await expect(verifyExternalBrowser({ ...await fixture(fake.transport), onExpectedFailure: async () => { calls++; } })).rejects.toThrow();
    expect(calls).toBe(0); expect(fake.closed).toHaveLength(1);
  }
});
