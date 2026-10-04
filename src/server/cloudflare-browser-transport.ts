import type { HTTPRequest, Page, WorkersLaunchOptions, ConnectOptions } from '@cloudflare/puppeteer';
import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping';
import { z } from 'zod';
import type { BrowserAction, BrowserQuery, BrowserVerificationTransport } from './external-browser-verifier';

type Commands = 'Browser.setDownloadBehavior' | 'Target.setAutoAttach' | 'Target.closeTarget' | 'Page.getFrameTree' | 'Page.createIsolatedWorld' | 'Runtime.evaluate' | 'Network.enable' | 'Input.dispatchMouseEvent' | 'Input.insertText' | 'Input.dispatchKeyEvent';
export interface BrowserCdpPort {
  send<T extends Commands>(method: T, params?: ProtocolMapping.Commands[T]['paramsType'][0]): Promise<ProtocolMapping.Commands[T]['returnType']>;
  on(event: 'Network.webSocketCreated' | 'Target.attachedToTarget', listener: (event: unknown) => void): unknown;
}
export interface BrowserRequestPort extends Pick<HTTPRequest, 'url' | 'method' | 'resourceType' | 'abort' | 'respond'> { frame(): unknown; redirectChain(): readonly unknown[] }
export interface BrowserPagePort extends Pick<Page, 'setBypassCSP' | 'setBypassServiceWorker' | 'setCacheEnabled' | 'setRequestInterception' | 'setDefaultTimeout' | 'setDefaultNavigationTimeout'> {
  goto(url: string, options: { waitUntil: 'networkidle0'; timeout: number }): Promise<unknown>;
  createCDPSession(): Promise<BrowserCdpPort>;
  on(event: 'request', listener: (request: BrowserRequestPort) => void): unknown;
}
export interface BrowserContextPort { readonly id: string | undefined; readonly closed: boolean; newPage(): Promise<BrowserPagePort>; close(): Promise<void>; overridePermissions(origin: string, permissions: []): Promise<void> }
export interface BrowserPort { readonly connected: boolean; version?(): Promise<string>; createBrowserContext(): Promise<BrowserContextPort>; close(): Promise<void> }
export type BrowserSessionControl = Pick<BrowserRun, 'closeSession' | 'getSession'>;
/** SDK consumes the callable fetch method only; Bun's global fetch.preconnect is not
 * part of a Worker binding's runtime contract. */
export interface VerificationBrowserBinding { fetch(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> }
export interface BrowserSdkPort {
  acquire(binding: VerificationBrowserBinding, options: WorkersLaunchOptions): Promise<{ sessionId: string }>;
  connect(binding: VerificationBrowserBinding | ConnectOptions, sessionId: string): Promise<BrowserPort>;
}
async function loadBrowserSdk(): Promise<BrowserSdkPort> { return (await import('@cloudflare/puppeteer')).default; }
export const cloudflareBrowserSdk: BrowserSdkPort = {
  async acquire(binding, options) { return (await loadBrowserSdk()).acquire(binding, options); },
  async connect(binding, sessionId) { return (await loadBrowserSdk()).connect(binding, sessionId); },
};
export interface CloudflareBrowserTransportOptions {
  binding: VerificationBrowserBinding & Partial<BrowserSessionControl>;
  sessionControl?: BrowserSessionControl;
  sdk?: BrowserSdkPort;
  authorize: () => Promise<void>;
  funding: () => Promise<void>;
  /** Test injection uses strict synthetic ports; production defaults to the installed Cloudflare SDK. */
  launch?: () => Promise<BrowserPort>;
  cleanupMs?: number;
}
type Allocation = Parameters<BrowserVerificationTransport['allocate']>[0];
type Lease = { options: Allocation; closing: boolean; failed: boolean; pending: Promise<void>; operations: Set<Promise<unknown>>; launchIssued?: boolean; sessionId?: string; browser?: BrowserPort; context?: BrowserContextPort; page?: BrowserPagePort; cdp?: BrowserCdpPort; cleanup?: Promise<boolean> };
async function within<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted(); let abort = () => {};
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { abort = () => reject(Error('Browser transport deadline')); signal.addEventListener('abort', abort, { once: true }); })]); }
  finally { signal.removeEventListener('abort', abort); }
}
/** Dedicated Cloudflare browser per lease. Candidate code executes only in that browser;
 * trusted DOM reads use a fresh CDP isolated world, never the page's JavaScript realm. */
export class CloudflareBrowserTransport implements BrowserVerificationTransport {
  private readonly leases = new Map<string, Lease>();
  private readonly sdk: BrowserSdkPort;
  private readonly sessionControl: BrowserSessionControl | undefined;
  private readonly cleanupMs: number;
  constructor(private readonly config: CloudflareBrowserTransportOptions) {
    this.sdk = config.sdk ?? cloudflareBrowserSdk;
    const binding = config.binding;
    this.sessionControl = config.sessionControl ?? (binding.closeSession && binding.getSession ? { closeSession: id => binding.closeSession!(id), getSession: id => binding.getSession!(id) } : undefined);
    this.cleanupMs = config.cleanupMs ?? 8000;
    if (!Number.isInteger(this.cleanupMs) || this.cleanupMs < 1 || this.cleanupMs > 8000) throw Error('Invalid browser cleanup bound');
  }
  private assert(lease: Lease, signal: AbortSignal) {
    signal.throwIfAborted(); lease.options.signal.throwIfAborted();
    if (lease.closing || lease.failed || this.leases.get(lease.options.leaseId) !== lease) throw Error('Browser lease is stale or denied');
  }
  private async fresh(lease: Lease, signal = lease.options.signal) {
    this.assert(lease, signal); await within(this.config.authorize(), signal); this.assert(lease, signal);
    await within(this.config.funding(), signal); this.assert(lease, signal);
  }
  private track<T>(lease: Lease, work: () => Promise<T>): Promise<T> {
    const promise = Promise.resolve().then(work); lease.operations.add(promise);
    void promise.then(() => lease.operations.delete(promise), () => lease.operations.delete(promise)); return promise;
  }
  private async step<T>(lease: Lease, work: () => Promise<T>, signal = lease.options.signal) {
    await this.fresh(lease, signal); const result = await within(work(), signal); await this.fresh(lease, signal); return result;
  }
  async allocate(options: Allocation) {
    if (!z.uuid().safeParse(options.leaseId).success || options.origin !== `https://${options.leaseId}.verification.invalid` || options.isolation !== 'fresh-no-credentials' || this.leases.has(options.leaseId) || this.leases.size >= 128) throw Error('Invalid or consumed browser lease');
    const lease: Lease = { options: Object.freeze({ ...options }), closing: false, failed: false, pending: Promise.resolve(), operations: new Set() };
    this.leases.set(options.leaseId, lease);
    // Register allocation before its first callback/launch await, including a launch that settles late.
    lease.pending = Promise.resolve().then(async () => {
      try {
        await this.fresh(lease);
        if (this.config.launch) {
          lease.launchIssued = true; lease.browser = await this.config.launch(); await this.fresh(lease);
        } else {
          // SDK launch hides the acquired ID if connect fails. Capture it before connecting so
          // cleanup can address only this lease, including cancellation between the two phases.
          if (!this.sessionControl) throw Error('Native exact-session cleanup binding required');
          lease.launchIssued = true;
          const acquired = await this.sdk.acquire(this.config.binding, { guardrails: { allowedDomains: [new URL(lease.options.origin).hostname] } });
          lease.sessionId = z.uuid().parse(acquired.sessionId); await this.fresh(lease);
          lease.browser = await this.sdk.connect(this.config.binding, lease.sessionId); await this.fresh(lease);
        }
        lease.context = await lease.browser.createBrowserContext(); await this.fresh(lease);
        if (!lease.context.id || lease.context.closed) throw Error('Fresh browser context required');
        await this.step(lease, () => lease.context!.overridePermissions(lease.options.origin, []));
        lease.page = await this.step(lease, () => lease.context!.newPage());
        lease.page.setDefaultTimeout(5000); lease.page.setDefaultNavigationTimeout(5000);
        lease.cdp = await this.step(lease, () => lease.page!.createCDPSession());
        lease.cdp.on('Network.webSocketCreated', () => { lease.failed = true; });
        lease.cdp.on('Target.attachedToTarget', event => {
          lease.failed = true;
          // Targets are paused before candidate worker execution, and never resumed.
          const parsed = z.object({ targetInfo: z.object({ targetId: z.string(), type: z.string() }) }).safeParse(event);
          if (parsed.success) void this.track(lease, () => lease.cdp!.send('Target.closeTarget', { targetId: parsed.data.targetInfo.targetId })).catch(() => { lease.failed = true; });
        });
        await this.step(lease, () => lease.cdp!.send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId: lease.context!.id }));
        await this.step(lease, () => lease.cdp!.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'worker' }, { type: 'service_worker' }, { type: 'shared_worker' }, { exclude: true }] }));
        await this.step(lease, () => lease.cdp!.send('Network.enable'));
        await this.step(lease, () => lease.page!.setBypassCSP(false));
        await this.step(lease, () => lease.page!.setBypassServiceWorker(true));
        await this.step(lease, () => lease.page!.setCacheEnabled(false));
        lease.page.on('request', request => {
          void this.track(lease, async () => {
            try {
              await this.fresh(lease);
              const response = await lease.options.intercept({ url: request.url(), method: request.method(), redirected: request.redirectChain().length !== 0, serviceWorker: request.frame() === null, resourceType: request.resourceType() });
              await this.fresh(lease);
              if ('abort' in response) { lease.failed = true; await request.abort('blockedbyclient'); }
              else await request.respond({ status: response.status, headers: response.headers, body: response.bytes });
              await this.fresh(lease);
            } catch { lease.failed = true; try { await request.abort('blockedbyclient'); } catch { /* Browser close is the final containment boundary. */ } }
          });
        });
        await this.step(lease, () => lease.page!.setRequestInterception(true));
      } catch (error) {
        lease.failed = true;
        if (lease.closing) await this.destroy(lease);
        throw error;
      }
    });
    void lease.pending.catch(() => {});
    await within(lease.pending, lease.options.signal);
  }
  private current(id: string, signal: AbortSignal) {
    const lease = this.leases.get(id); if (!lease?.page || !lease.cdp) throw Error('Browser lease is unavailable'); this.assert(lease, signal); return lease;
  }
  private async isolated(lease: Lease, expression: string, signal: AbortSignal): Promise<unknown> {
    const tree = await this.step(lease, () => lease.cdp!.send('Page.getFrameTree'), signal);
    if (new URL(tree.frameTree.frame.url).origin !== lease.options.origin) throw Error('Browser frame escaped bound origin');
    const world = await this.step(lease, () => lease.cdp!.send('Page.createIsolatedWorld', { frameId: tree.frameTree.frame.id, worldName: `flaregit-${lease.options.leaseId}`, grantUniveralAccess: false }), signal);
    const read = await this.step(lease, () => lease.cdp!.send('Runtime.evaluate', { expression, contextId: world.executionContextId, returnByValue: true, awaitPromise: false, includeCommandLineAPI: false, timeout: 5000 }), signal);
    if (read.exceptionDetails) throw Error('Isolated browser operation failed'); return read.result.value;
  }
  async act(id: string, input: BrowserAction, signal: AbortSignal) {
    const lease = this.current(id, signal), action = structuredClone(input);
    await this.track(lease, async () => {
      await this.fresh(lease, signal);
      if (action.kind === 'navigate') {
        if (!/^\/[a-zA-Z0-9_./-]*$/.test(action.path) || action.path.includes('//') || action.path.split('/').some(part => part === '..' || part === '.')) throw Error('Invalid browser navigation');
        await this.step(lease, () => lease.page!.goto(lease.options.origin + action.path, { waitUntil: 'networkidle0', timeout: 5000 }), signal);
      } else if (action.kind === 'click') {
        const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict().parse(await this.isolated(lease, `(()=>{const e=document.querySelector(${JSON.stringify(action.selector)});if(!(e instanceof HTMLElement))throw Error('Missing element');e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0)throw Error('Hidden element');return {x:r.x+r.width/2,y:r.y+r.height/2};})()`, signal));
        await this.step(lease, () => lease.cdp!.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }), signal);
        await this.step(lease, () => lease.cdp!.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }), signal);
      } else if (action.kind === 'fill') {
        await this.isolated(lease, `(()=>{const e=document.querySelector(${JSON.stringify(action.selector)});if(!(e instanceof HTMLInputElement)&&!(e instanceof HTMLTextAreaElement))throw Error('Unsupported fill target');e.focus();return true;})()`, signal);
        await this.step(lease, () => lease.cdp!.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, commands: ['selectAll'] }), signal);
        await this.step(lease, () => lease.cdp!.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 }), signal);
        await this.step(lease, () => lease.cdp!.send('Input.insertText', { text: action.value }), signal);
      } else if (action.kind === 'select') {
        // Clean-world native DOM setter bypasses candidate prototype overrides. This supports
        // single-select change semantics; events are intentionally synthetic (isTrusted=false).
        await this.isolated(lease, `(()=>{const e=document.querySelector(${JSON.stringify(action.selector)}),value=${JSON.stringify(action.value)};if(!(e instanceof HTMLSelectElement)||e.matches(':disabled')||e.multiple)throw Error('Unsupported select target');const matches=Array.from(e.options).filter(option=>option.value===value);if(matches.length!==1)throw Error('Select value must identify one option');const option=matches[0];if(option.disabled||option.parentElement instanceof HTMLOptGroupElement&&option.parentElement.disabled)throw Error('Disabled select option');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')?.set;if(!setter)throw Error('Native select setter unavailable');e.focus();setter.call(e,value);if(e.value!==value)throw Error('Select value did not apply');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`, signal);
      } else throw Error('Unsupported browser action');
      await this.fresh(lease, signal);
    });
  }
  async observe(id: string, input: BrowserQuery, signal: AbortSignal) {
    const lease = this.current(id, signal), query = structuredClone(input);
    return this.track(lease, async () => {
      if (query.kind === 'texts') {
        const maxRows = z.number().int().min(1).max(64).parse(query.maxRows);
        const rows = await this.isolated(lease, `(()=>{const rows=document.querySelectorAll(${JSON.stringify(query.selector)});if(rows.length>${maxRows})throw Error('Receipt row bound exceeded');return Array.from(rows,e=>{const value=e.textContent;if(value.length>32)throw Error('Receipt text bound exceeded');return value;});})()`, signal);
        return z.array(z.string().max(32)).max(maxRows).parse(rows);
      }
      const attribute = query.kind === 'attribute' ? z.literal('data-event-id').parse(query.attribute) : undefined;
      const value = await this.isolated(lease, `(()=>{const kind=${JSON.stringify(query.kind)},selector=${JSON.stringify(query.selector)};if(kind==='count')return document.querySelectorAll(selector).length;const e=document.querySelector(selector);if(!e)throw Error('Missing element');const bounded=value=>{if(typeof value!=='string'||value.length>16384)throw Error('Observation text bound exceeded');return value;};if(kind==='text')return bounded(e.textContent);if(kind==='attribute')return bounded(e.getAttribute(${JSON.stringify(attribute)}));if(kind==='value'){if(!(e instanceof HTMLInputElement)&&!(e instanceof HTMLTextAreaElement)&&!(e instanceof HTMLSelectElement))throw Error('Unsupported value target');return bounded(e.value);}if(kind==='visible'){const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.visibility!=='collapse'&&s.display!=='none';}throw Error('Unsupported observation');})()`, signal);
      return z.union([z.string().max(16384), z.boolean(), z.number().int().min(0).max(10000)]).parse(value);
    });
  }
  private destroy(lease: Lease): Promise<boolean> {
    if (lease.cleanup) return lease.cleanup;
    lease.cleanup = (async () => {
      const signal = AbortSignal.timeout(this.cleanupMs); let contextClosed = !lease.context, browserClosed = !lease.browser && !lease.launchIssued;
      if (lease.context) { try { await within(lease.context.close(), signal); contextClosed = lease.context.closed; } catch { contextClosed = false; } }
      if (lease.browser) { try { await within(lease.browser.close(), signal); browserClosed = !lease.browser.connected; } catch { browserClosed = false; } }
      if (lease.sessionId && this.sessionControl) {
        try {
          // SDK 1.4.0 catches Browser.close errors then disconnects. Disconnection alone is
          // insufficient: independently retire and read back this exact acquired session.
          const retired = await retireBrowserSession(this.sessionControl, lease.sessionId, { timeoutMs: this.cleanupMs, signal });
          return retired !== null && (!lease.browser || browserClosed);
        } catch { return false; }
      }
      return contextClosed && browserClosed;
    })(); return lease.cleanup;
  }
  async close(id: string) {
    const lease = this.leases.get(id); if (!lease) return { leaseId: id, closed: false };
    lease.closing = true;
    try {
      const signal = AbortSignal.timeout(this.cleanupMs);
      await within(lease.pending.catch(() => {}), signal);
      const destroyed = await within(this.destroy(lease), signal);
      await within(Promise.allSettled([...lease.operations]), signal);
      return { leaseId: id, closed: destroyed && !lease.browser?.connected && (!lease.context || lease.context.closed) };
    } catch { return { leaseId: id, closed: false }; }
  }
}

export interface BrowserSessionRetirement { sessionId: string; observation: 'closed' | 'absent'; observedAt: number }
/** Exact-session native retirement truth shared with admission ledgers. No account inventory,
 * caller success booleans, or SDK disconnection report may substitute for provider observation. */
export async function retireBrowserSession(control: BrowserSessionControl, sessionId: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<BrowserSessionRetirement | null> {
  const timeoutMs = options.timeoutMs ?? 8000;
  if (!z.uuid().safeParse(sessionId).success || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8000) return null;
  const deadline = AbortSignal.timeout(timeoutMs), signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  try {
    signal.throwIfAborted();
    const closed = await within(control.closeSession(sessionId), signal);
    if (closed.status !== 'closed' && closed.status !== 'closing') return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const observed: Awaited<ReturnType<BrowserSessionControl['getSession']>> = await within(control.getSession(sessionId), signal);
      if (observed !== null && observed.sessionId !== sessionId) return null;
      if (observed === null) return { sessionId, observation: 'absent', observedAt: Date.now() };
      if (typeof observed.endTime === 'number' && Number.isFinite(observed.endTime) && observed.endTime > 0) return { sessionId, observation: 'closed', observedAt: Date.now() };
      if (attempt < 2) await within(new Promise<void>(resolve => setTimeout(resolve, 50 * (attempt + 1))), signal);
    }
    return null;
  } catch { return null; }
}
