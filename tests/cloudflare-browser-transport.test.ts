import { expect, test } from 'bun:test';
import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping';
import { CloudflareBrowserTransport, retireBrowserSession, type BrowserPort, type BrowserContextPort, type BrowserPagePort, type BrowserCdpPort, type BrowserRequestPort } from '../src/server/cloudflare-browser-transport';
import type { BrowserVerificationTransport } from '../src/server/external-browser-verifier';

// Strict typed synthetic ports only. These tests do not launch Chromium or prove Cloudflare isolation.
function synthetic() {
  const calls: string[] = [], commands: Array<{ method: string; params: unknown }> = [];
  const events = new Map<string, (event: unknown) => void>();
  let requestHandler: ((request: BrowserRequestPort) => void) | undefined;
  let result: unknown = 'Approved', connected = true, contextClosed = false;
  const leaseId = crypto.randomUUID(), origin = `https://${leaseId}.verification.invalid`;
  const cdp: BrowserCdpPort = {
    async send<T extends Parameters<BrowserCdpPort['send']>[0]>(method: T, params?: ProtocolMapping.Commands[T]['paramsType'][0]): Promise<ProtocolMapping.Commands[T]['returnType']> {
      calls.push(method); commands.push({ method, params });
      const response: unknown = method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'frame', url: origin + '/' } } } : method === 'Page.createIsolatedWorld' ? { executionContextId: 73 } : method === 'Runtime.evaluate' ? { result: { type: typeof result, value: result } } : {};
      // Generic protocol return correlation is supplied by the synthetic command switch above.
      return response as ProtocolMapping.Commands[T]['returnType'];
    },
    on(event, listener) { events.set(event, listener); },
  };
  const page: BrowserPagePort = {
    async createCDPSession() { calls.push('cdp'); return cdp; }, on(_event, listener) { requestHandler = listener; },
    async setBypassCSP(value) { calls.push(`csp:${value}`); }, async setBypassServiceWorker(value) { calls.push(`serviceworker:${value}`); }, async setCacheEnabled(value) { calls.push(`cache:${value}`); }, async setRequestInterception(value) { calls.push(`intercept:${value}`); },
    setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, async goto(url) { calls.push(`goto:${url}`); return null; },
  };
  const context: BrowserContextPort = { id: 'isolated-context', get closed() { return contextClosed; }, async newPage() { calls.push('page'); return page; }, async close() { calls.push('context.close'); contextClosed = true; }, async overridePermissions() { calls.push('permissions:none'); } };
  const browser: BrowserPort = { get connected() { return connected; }, async createBrowserContext() { calls.push('context'); return context; }, async close() { calls.push('browser.close'); connected = false; } };
  const transport = new CloudflareBrowserTransport({ binding: { fetch }, launch: async () => { calls.push('launch'); return browser; }, authorize: async () => { calls.push('authorize'); }, funding: async () => { calls.push('funding'); }, cleanupMs: 30 });
  const options: Parameters<BrowserVerificationTransport['allocate']>[0] = { leaseId, origin, signal: AbortSignal.timeout(2000), isolation: 'fresh-no-credentials', intercept: async () => ({ status: 200, headers: { 'content-type': 'text/html' }, bytes: new TextEncoder().encode('<h1>Approved</h1>') }) };
  return { transport, options, calls, commands, events, browser, context, page, setResult(value: unknown) { result = value; }, request(request: BrowserRequestPort) { requestHandler?.(request); } };
}
test('synthetic: security setup precedes navigation and CDP observations target isolated context', async () => {
  const fake = synthetic(); await fake.transport.allocate(fake.options);
  for (const operation of ['csp:false', 'serviceworker:true', 'cache:false', 'intercept:true', 'Browser.setDownloadBehavior', 'Target.setAutoAttach']) expect(fake.calls).toContain(operation);
  expect(fake.calls.some(call => call.startsWith('goto:'))).toBe(false);
  await fake.transport.act(fake.options.leaseId, { kind: 'navigate', path: '/' }, fake.options.signal);
  expect(fake.calls.indexOf('intercept:true')).toBeLessThan(fake.calls.indexOf(`goto:${fake.options.origin}/`));
  expect(await fake.transport.observe(fake.options.leaseId, { kind: 'text', selector: 'h1' }, fake.options.signal)).toBe('Approved');
  const evaluation = fake.commands.find(command => command.method === 'Runtime.evaluate');
  expect(evaluation?.params).toMatchObject({ contextId: 73, returnByValue: true, includeCommandLineAPI: false });
  expect(fake.commands.find(command => command.method === 'Page.createIsolatedWorld')?.params).toMatchObject({ grantUniveralAccess: false });
  expect(await fake.transport.close(fake.options.leaseId)).toEqual({ leaseId: fake.options.leaseId, closed: true });
  expect(fake.calls.slice(-2)).toEqual(['context.close', 'browser.close']);
});
test('synthetic: isolated actions use CDP input and never candidate main-world evaluation', async () => {
  const fake = synthetic(); await fake.transport.allocate(fake.options); fake.setResult({ x: 30, y: 40 });
  await fake.transport.act(fake.options.leaseId, { kind: 'click', selector: 'button' }, fake.options.signal);
  expect(fake.commands.filter(command => command.method === 'Input.dispatchMouseEvent').map(command => command.params)).toEqual([{ type: 'mousePressed', button: 'left', clickCount: 1, x: 30, y: 40 }, { type: 'mouseReleased', button: 'left', clickCount: 1, x: 30, y: 40 }]);
  fake.setResult(true); await fake.transport.act(fake.options.leaseId, { kind: 'fill', selector: 'input', value: 'Safe' }, fake.options.signal);
  expect(fake.commands.find(command => command.method === 'Input.insertText')?.params).toEqual({ text: 'Safe' });
  await fake.transport.close(fake.options.leaseId);
});
test('synthetic: malformed observations and escaped navigation fail instead of returning page success', async () => {
  const fake = synthetic(); await fake.transport.allocate(fake.options); fake.setResult({ passed: true });
  await expect(fake.transport.observe(fake.options.leaseId, { kind: 'text', selector: 'h1' }, fake.options.signal)).rejects.toThrow();
  await expect(fake.transport.act(fake.options.leaseId, { kind: 'navigate', path: '//external.example/' }, fake.options.signal)).rejects.toThrow();
  await fake.transport.close(fake.options.leaseId);
});
test('synthetic: pending launch cannot produce a positive cleanup receipt; late browser is still closed', async () => {
  const fake = synthetic(); let resolveLaunch!: (browser: BrowserPort) => void;
  const launch = new Promise<BrowserPort>(resolve => { resolveLaunch = resolve; }); let launched = false;
  const transport = new CloudflareBrowserTransport({ binding: { fetch }, launch: () => { launched = true; return launch; }, authorize: async () => {}, funding: async () => {}, cleanupMs: 10 });
  const allocation = transport.allocate(fake.options).catch(() => {});
  while (!launched) await Promise.resolve();
  expect(await transport.close(fake.options.leaseId)).toEqual({ leaseId: fake.options.leaseId, closed: false });
  resolveLaunch(fake.browser); await allocation;
  expect(fake.browser.connected).toBe(false); expect(fake.calls).toContain('browser.close');
});
test('synthetic: authority revoked after launch prevents context creation and still requires cleanup', async () => {
  const fake = synthetic(); let launched = false;
  const transport = new CloudflareBrowserTransport({ binding: { fetch }, launch: async () => { launched = true; return fake.browser; }, authorize: async () => { if (launched) throw Error('revoked'); }, funding: async () => {} });
  await expect(transport.allocate(fake.options)).rejects.toThrow('revoked'); expect(fake.calls).not.toContain('context');
  expect(await transport.close(fake.options.leaseId)).toEqual({ leaseId: fake.options.leaseId, closed: true });
});
test('synthetic: funding exhausted before launch, duplicate leases and stale actions fail closed', async () => {
  const fake = synthetic(); let launches = 0;
  const transport = new CloudflareBrowserTransport({ binding: { fetch }, launch: async () => { launches++; return fake.browser; }, authorize: async () => {}, funding: async () => { throw Error('funding'); } });
  await expect(transport.allocate(fake.options)).rejects.toThrow('funding'); expect(launches).toBe(0);
  await fake.transport.allocate(fake.options); await expect(fake.transport.allocate(fake.options)).rejects.toThrow('consumed');
  await fake.transport.close(fake.options.leaseId);
  await expect(fake.transport.act(fake.options.leaseId, { kind: 'navigate', path: '/' }, fake.options.signal)).rejects.toThrow('stale');
});
test('synthetic: unsupported worker or websocket event poisons lease before further observations', async () => {
  for (const event of ['Network.webSocketCreated', 'Target.attachedToTarget']) {
    const fake = synthetic(); await fake.transport.allocate(fake.options); fake.events.get(event)?.({ targetInfo: { targetId: 'worker-target', type: 'worker' } });
    await expect(fake.transport.observe(fake.options.leaseId, { kind: 'text', selector: 'h1' }, fake.options.signal)).rejects.toThrow('denied');
    expect((await fake.transport.close(fake.options.leaseId)).closed).toBe(true);
    if (event === 'Target.attachedToTarget') expect(fake.commands.some(command => command.method === 'Target.closeTarget')).toBe(true);
  }
});
test('synthetic: failed browser or context closure cannot report confirmed cleanup', async () => {
  for (const target of ['browser', 'context'] as const) {
    const fake = synthetic(); await fake.transport.allocate(fake.options); fake[target].close = async () => { throw Error('close failed'); };
    expect((await fake.transport.close(fake.options.leaseId)).closed).toBe(false);
  }
});
test('synthetic: intercepted bytes are fulfilled locally using captured immutable lease callbacks', async () => {
  const fake = synthetic(); await fake.transport.allocate(fake.options);
  fake.options.intercept = async () => { throw Error('mutated caller callback'); };
  let complete!: () => void; const responded = new Promise<void>(resolve => { complete = resolve; });
  let body: unknown, aborted = false;
  fake.request({ url: () => fake.options.origin + '/', method: () => 'GET', redirectChain: () => [], frame: () => ({}), resourceType: () => 'document',
    async respond(response) { body = response.body; complete(); }, async abort() { aborted = true; complete(); } });
  await responded;
  expect(body instanceof Uint8Array ? new TextDecoder().decode(body) : '').toBe('<h1>Approved</h1>'); expect(aborted).toBe(false);
  expect((await fake.transport.close(fake.options.leaseId)).closed).toBe(true);
});
test('synthetic: rejected SDK launch cannot falsely confirm cleanup of a possibly acquired provider session', async () => {
  const fake = synthetic();
  const transport = new CloudflareBrowserTransport({ binding: { fetch }, launch: async () => { throw Error('acquired but connect failed'); }, authorize: async () => {}, funding: async () => {} });
  await expect(transport.allocate(fake.options)).rejects.toThrow('connect failed');
  expect((await transport.close(fake.options.leaseId)).closed).toBe(false);
});
test('synthetic: production acquisition binds exact native hostname guardrails and independently confirms session cleanup', async () => {
  const fake = synthetic(); const sessionId = crypto.randomUUID();
  let acquireOptions: unknown, connectedId: string | undefined; const nativeCalls: string[] = [];
  const transport = new CloudflareBrowserTransport({ binding: { fetch }, authorize: async () => {}, funding: async () => {},
    sdk: { async acquire(_binding, options) { acquireOptions = options; return { sessionId }; }, async connect(_binding, id) { connectedId = id; return fake.browser; } },
    sessionControl: { async closeSession(id) { nativeCalls.push(`close:${id}`); return { status: 'closed' }; }, async getSession(id) { nativeCalls.push(`get:${id}`); return null; } },
  });
  await transport.allocate(fake.options);
  expect(acquireOptions).toEqual({ guardrails: { allowedDomains: [new URL(fake.options.origin).hostname] } }); expect(connectedId).toBe(sessionId);
  expect((await transport.close(fake.options.leaseId)).closed).toBe(true); expect(nativeCalls).toEqual([`get:${sessionId}`]);
});
test('synthetic: explicit acquisition retains the session ID across connect failure for scoped cleanup', async () => {
  const fake = synthetic(), sessionId = crypto.randomUUID(); const cleaned: string[] = [];
  const transport = new CloudflareBrowserTransport({ binding: { fetch }, authorize: async () => {}, funding: async () => {},
    sdk: { async acquire() { return { sessionId }; }, async connect() { throw Error('connect failed'); } },
    sessionControl: { async closeSession(id) { cleaned.push(id); return { status: 'closed' }; }, async getSession() { return cleaned.length ? null : {sessionId}; } },
  });
  await expect(transport.allocate(fake.options)).rejects.toThrow('connect failed');
  expect((await transport.close(fake.options.leaseId)).closed).toBe(true); expect(cleaned).toEqual([sessionId]);
});
test('synthetic: SDK disconnect and native closing status cannot replace positive provider readback', async () => {
  for (const readback of ['active', 'wrong-session', 'failed'] as const) {
    const fake = synthetic(), sessionId = crypto.randomUUID();
    const transport = new CloudflareBrowserTransport({ binding: { fetch }, authorize: async () => {}, funding: async () => {},
      sdk: { async acquire() { return { sessionId }; }, async connect() { return fake.browser; } },
      sessionControl: { async closeSession() { return { status: 'closing' }; }, async getSession() { if (readback === 'failed') throw Error('provider unavailable'); return { sessionId: readback === 'wrong-session' ? crypto.randomUUID() : sessionId, ...(readback === 'wrong-session' ? { endTime: 1234 } : {}) }; } },
    });
    await transport.allocate(fake.options); expect((await transport.close(fake.options.leaseId)).closed).toBe(false); expect(fake.browser.connected).toBe(false);
  }
});
test('synthetic: revoked authority between acquire and connect prevents allocation continuation and permits scoped retirement', async () => {
  const fake = synthetic(), sessionId = crypto.randomUUID(); let acquired = false, connects = 0;
  const transport = new CloudflareBrowserTransport({ binding: { fetch }, authorize: async () => { if (acquired) throw Error('revoked'); }, funding: async () => {},
    sdk: { async acquire() { acquired = true; return { sessionId }; }, async connect() { connects++; return fake.browser; } },
    sessionControl: { async closeSession() { return { status: 'closed' }; }, async getSession() { return null; } },
  });
  await expect(transport.allocate(fake.options)).rejects.toThrow('revoked'); expect(connects).toBe(0); expect((await transport.close(fake.options.leaseId)).closed).toBe(true);
});
test('synthetic: production path refuses allocation without native exact-session cleanup capability', async () => {
  const fake = synthetic(); let acquisitions = 0;
  const transport = new CloudflareBrowserTransport({ binding: { fetch }, authorize: async () => {}, funding: async () => {}, sdk: { async acquire() { acquisitions++; return { sessionId: crypto.randomUUID() }; }, async connect() { return fake.browser; } } });
  await expect(transport.allocate(fake.options)).rejects.toThrow('cleanup binding required'); expect(acquisitions).toBe(0); expect((await transport.close(fake.options.leaseId)).closed).toBe(true);
});
test('synthetic: opaque acquisition failure stays unconfirmed without an attributable session ID', async () => {
  const fake = synthetic(); let cleanupCalls = 0;
  const transport = new CloudflareBrowserTransport({ binding: { fetch }, authorize: async () => {}, funding: async () => {},
    sdk: { async acquire() { throw Error('acquisition response lost'); }, async connect() { return fake.browser; } },
    sessionControl: { async closeSession() { cleanupCalls++; return { status: 'closed' }; }, async getSession() { cleanupCalls++; return null; } },
  });
  await expect(transport.allocate(fake.options)).rejects.toThrow('response lost'); expect((await transport.close(fake.options.leaseId)).closed).toBe(false); expect(cleanupCalls).toBe(0);
});
test('synthetic: native exact-session close and readback share a finite cleanup deadline', async () => {
  for (const pending of ['close', 'get'] as const) {
    const fake = synthetic(), sessionId = crypto.randomUUID();
    const transport = new CloudflareBrowserTransport({ binding: { fetch }, authorize: async () => {}, funding: async () => {}, cleanupMs: 10,
      sdk: { async acquire() { return { sessionId }; }, async connect() { return fake.browser; } },
      sessionControl: { async closeSession() { if (pending === 'close') return new Promise(() => {}); return { status: 'closed' }; }, async getSession() { return pending === 'close' ? {sessionId} : new Promise(() => {}); } },
    });
    await transport.allocate(fake.options); expect((await transport.close(fake.options.leaseId)).closed).toBe(false);
  }
});
test('synthetic: select action targets only the isolated CDP context', async () => {
  const fake = synthetic(); await fake.transport.allocate(fake.options); fake.setResult(true);
  await fake.transport.act(fake.options.leaseId, { kind: 'select', selector: 'select[name="shipping"]', value: 'overnight' }, fake.options.signal);
  const commands = fake.commands.filter(item => item.method === 'Runtime.evaluate');
  expect(commands).toHaveLength(1); expect(commands[0]?.params).toMatchObject({ contextId: 73, returnByValue: true });
  await fake.transport.close(fake.options.leaseId);
});
test('synthetic: asynchronous native closing gets finite exact-session retirement readbacks', async () => {
  const fake = synthetic(), sessionId = crypto.randomUUID(); const readIds: string[] = [];
  const transport = new CloudflareBrowserTransport({ binding: { fetch }, authorize: async () => {}, funding: async () => {}, cleanupMs: 500,
    sdk: { async acquire() { return { sessionId }; }, async connect() { return fake.browser; } },
    sessionControl: { async closeSession() { return { status: 'closing' }; }, async getSession(id) { readIds.push(id); return readIds.length === 1 ? { sessionId } : null; } },
  });
  await transport.allocate(fake.options); expect((await transport.close(fake.options.leaseId)).closed).toBe(true); expect(readIds).toEqual([sessionId, sessionId]);
});

test('synthetic: retirement helper returns exact provider observation and bounded timestamp, never a caller boolean', async () => {
  const sessionId = crypto.randomUUID();
  for (const absent of [true, false]) {
    const before = Date.now(); const observation = await retireBrowserSession({ async closeSession() { return { status: 'closed' }; }, async getSession(id) { return absent ? null : { sessionId: id, endTime: before }; } }, sessionId);
    expect(observation).toMatchObject({ sessionId, observation: absent ? 'absent' : 'closed' }); expect(observation!.observedAt).toBeGreaterThanOrEqual(before);
  }
  let calls = 0; const aborted = AbortSignal.abort();
  expect(await retireBrowserSession({ async closeSession() { calls++; return { status: 'closed' }; }, async getSession() { return null; } }, sessionId, { signal: aborted })).toBeNull(); expect(calls).toBe(0);
});
// Opt-in existing local Chromium only; default CI does not download or launch a browser.
test.skipIf(!process.env.FLAREGIT_LOCAL_CHROMIUM_PATH)('local Chromium only: isolated DOM authority, number replacement, select events and receipt arithmetic', async () => {
  const { PuppeteerNode } = await import('@cloudflare/puppeteer/internal/node/PuppeteerNode.js');
  const { bindBuildManifest } = await import('../src/server/static-build-artifact');
  const { bindBrowserPolicy, verifyExternalBrowser } = await import('../src/server/external-browser-verifier');
  const local = new PuppeteerNode({ isPuppeteerCore: true });
  const html = `<!doctype html><link rel="icon" type="image/svg+xml" href="/favicon.svg"><h1>Approved</h1><h2 id="event" data-event-id="cf-connect-2026">Event</h2><input id="weight" type="number" value="5"><span id="weight-change">5</span><select id="speed"><option value="standard">Standard</option><option value="express">Express</option></select><span id="selection">standard</span><div id="receipt"><span data-receipt-amount>$30.00</span><span data-receipt-amount>$15.00</span></div><div id="total">Total: $45.00</div><script>const input=document.getElementById('weight'),weightChange=document.getElementById('weight-change'),speed=document.getElementById('speed'),selection=document.getElementById('selection');input.addEventListener('input',()=>{weightChange.textContent=input.value});speed.addEventListener('change',()=>{selection.textContent=speed.value});document.querySelector=()=>({textContent:'FAKE',getAttribute:()=> 'fake-event'});HTMLInputElement.prototype.select=()=>{};</script>`;
  const policy: import('../src/server/external-browser-verifier').BrowserPolicy = { version: 1, deadlineMs: 20000, cases: [{ id: 'local_only', actions: [{ kind: 'navigate', path: '/' }, { kind: 'fill', selector: '#weight', value: '2' }, { kind: 'select', selector: '#speed', value: 'express' }], assertions: [{ query: { kind: 'text', selector: 'h1' }, expected: 'Approved' }, { query: { kind: 'attribute', selector: '#event', attribute: 'data-event-id' }, expected: 'cf-connect-2026' }, { query: { kind: 'value', selector: '#weight' }, expected: '2' }, { query: { kind: 'text', selector: '#weight-change' }, expected: '2' }, { query: { kind: 'value', selector: '#speed' }, expected: 'express' }, { query: { kind: 'text', selector: '#selection' }, expected: 'express' }, { kind: 'receipt-sum', containerSelector: '#receipt', rowsSelector: '#receipt [data-receipt-amount]', totalSelector: '#total', totalPrefix: 'Total: ', optional: true, maxRows: 64 }] }] };
  const bound = await bindBrowserPolicy(policy), scope = { attemptId: crypto.randomUUID(), projectId: 'abcdefghijkl', incarnation: crypto.randomUUID(), commit: 'a'.repeat(40), tree: 'b'.repeat(40), policyDigest: bound.digest };
  const files = [{ path: 'index.html', kind: 'file' as const, bytes: new TextEncoder().encode(html) }, { path: 'favicon.svg', kind: 'file' as const, bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#334155"/></svg>') }];
  const source = await bindBuildManifest('source', scope, files), output = await bindBuildManifest('static', scope, files, source.digest);
  const transport = new CloudflareBrowserTransport({ binding: { fetch }, launch: () => local.launch({ executablePath: process.env.FLAREGIT_LOCAL_CHROMIUM_PATH, headless: true, args: ['--disable-background-networking', '--disable-component-update', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND'] }), authorize: async () => {}, funding: async () => {} });
  const receipt = await verifyExternalBrowser({ scope, source, sourceFiles: files, output, outputFiles: files, policy, transport, authorize: async () => {}, budget: async () => {} });
  expect(receipt.cases).toEqual([{ id: 'local_only', assertions: 7, passed: true }]); expect(receipt.cleanup).toBe('confirmed');
}, 25000);
test.skipIf(!process.env.FLAREGIT_LOCAL_CHROMIUM_PATH)('local Chromium only: approved fixture HTML builds execute their complete browser inventories', async () => {
  const { PuppeteerNode } = await import('@cloudflare/puppeteer/internal/node/PuppeteerNode.js');
  const { bindBuildManifest } = await import('../src/server/static-build-artifact');
  const { bindBrowserPolicy, verifyExternalBrowser } = await import('../src/server/external-browser-verifier');
  const { ticketBookingBrowserInventory, shippingCalculatorBrowserInventory } = await import('../src/server/trusted-fixture-browser-policies');
  const local = new PuppeteerNode({ isPuppeteerCore: true });
  for (const inventory of [ticketBookingBrowserInventory({}), shippingCalculatorBrowserInventory()]) {
    const template = new URL(`../src/fixtures/${inventory.fixture}/template/`, import.meta.url).pathname;
    const sourceFiles: import('../src/server/static-build-artifact').BuildFile[] = [];
    for await (const path of new Bun.Glob('**/*').scan({ cwd: template, onlyFiles: true })) sourceFiles.push({ path, kind: 'file', bytes: new Uint8Array(await Bun.file(template + path).arrayBuffer()) });
    // Compile only; no candidate modules or pricing functions execute in this trusted host.
    const build = await Bun.build({ entrypoints: [template + 'index.html'], target: 'browser', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
    expect(build.success).toBe(true);
    const outputFiles = await Promise.all(build.outputs.map(async file => ({ path: file.path.replace(/^\.\//, ''), kind: 'file' as const, bytes: new Uint8Array(await file.arrayBuffer()) })));
    const bound = await bindBrowserPolicy(inventory.policy), scope = { attemptId: crypto.randomUUID(), projectId: 'abcdefghijkl', incarnation: crypto.randomUUID(), commit: 'a'.repeat(40), tree: 'b'.repeat(40), policyDigest: bound.digest };
    const source = await bindBuildManifest('source', scope, sourceFiles), output = await bindBuildManifest('static', scope, outputFiles, source.digest);
    const transport = new CloudflareBrowserTransport({ binding: { fetch }, launch: () => local.launch({ executablePath: process.env.FLAREGIT_LOCAL_CHROMIUM_PATH, headless: true, args: ['--disable-background-networking', '--disable-component-update', '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND'] }), authorize: async () => {}, funding: async () => {} });
    const receipt = await verifyExternalBrowser({ scope, source, sourceFiles, output, outputFiles, policy: inventory.policy, transport, authorize: async () => {}, budget: async () => {} });
    expect(receipt.cases.map(item => item.id)).toEqual(inventory.policy.cases.map(item => item.id)); expect(receipt.cleanup).toBe('confirmed');
  }
}, 150000);

test('synthetic: exact already-closed native session settles cleanup without a second close acknowledgement',async()=>{const sessionId=crypto.randomUUID(),calls:string[]=[];for(const absent of [false,true]){const proof=await retireBrowserSession({async closeSession(){throw Error('already closed');},async getSession(id){calls.push(id);return absent?null:{sessionId:id,endTime:Date.now()};}},sessionId);expect(proof?.observation).toBe(absent?'absent':'closed');expect(proof?.sessionId).toBe(sessionId);}expect(calls).toEqual([sessionId,sessionId]);});
test('synthetic: parallel close acknowledgement loss requires independent exact native closure readback',async()=>{const sessionId=crypto.randomUUID();for(const closed of [true,false]){let reads=0,closes=0;const proof=await retireBrowserSession({async closeSession(id){expect(id).toBe(sessionId);closes++;throw Error('repeated close rejected');},async getSession(id){reads++;return reads>1&&closed?{sessionId:id,endTime:Date.now()}:{sessionId:id};}},sessionId,{timeoutMs:500});expect(closes).toBe(1);expect(proof?.observation??null).toBe(closed?'closed':null);}});

test('synthetic: exact getter error accepts only one positive known native history record',async()=>{const sessionId=crypto.randomUUID(),historyOptions:unknown[]=[],getIds:string[]=[];let closes=0;const proof=await retireBrowserSession({async closeSession(){closes++;return{status:'closed'};},async getSession(id){getIds.push(id);throw Error('native exact lookup not found');},async history(options){historyOptions.push(options);return[{sessionId:crypto.randomUUID(),startTime:1,endTime:2},{sessionId,startTime:100,endTime:200}];}},sessionId);expect(proof).toMatchObject({sessionId,observation:'closed',providerObservation:'exact-history',providerStartTime:100,providerEndTime:200});expect(historyOptions).toEqual([{limit:50,offset:0}]);expect(getIds).toEqual([sessionId]);expect(closes).toBe(0);});
test('synthetic: native history absence, duplicate, active, invalid time or unavailable response cannot retire the known session',async()=>{const sessionId=crypto.randomUUID();for(const records of [[],[{sessionId,startTime:100}],[{sessionId,startTime:100,endTime:99}],[{sessionId,startTime:100,endTime:Infinity}],[{sessionId,startTime:100,endTime:200},{sessionId,startTime:100,endTime:200}],Array.from({length:51},()=>({sessionId,startTime:100,endTime:200}))]){let histories=0;const proof=await retireBrowserSession({async closeSession(){return{status:'closed'};},async getSession(){throw Error('not found');},async history(){histories++;return records;}},sessionId);expect(proof).toBeNull();expect(histories).toBe(1);}expect(await retireBrowserSession({async closeSession(){return{status:'closed'};},async getSession(){throw Error('not found');},async history(){throw Error('unavailable');}},sessionId)).toBeNull();});
test('synthetic: native history cannot override an exact active or wrong-session observation',async()=>{const sessionId=crypto.randomUUID();for(const id of [sessionId,crypto.randomUUID()]){let histories=0;const proof=await retireBrowserSession({async closeSession(){return{status:'closing'};},async getSession(){return{sessionId:id};},async history(){histories++;return[{sessionId,startTime:100,endTime:200}];}},sessionId,{timeoutMs:500});expect(proof).toBeNull();expect(histories).toBe(0);}});
