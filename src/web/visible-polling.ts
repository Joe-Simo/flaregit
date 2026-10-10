export interface PollingEnvironment {
  visible(): boolean;
  subscribe(listener: () => void): () => void;
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}
export interface VisiblePollingOptions<T> {
  intervalMs: number;
  maxBackoffMs?: number;
  read(signal: AbortSignal): Promise<T>;
  onValue(value: T): void;
  onError(error: unknown): void;
  /** Minimum wait before the next background read after this failure (for example a 429's Retry-After). */
  retryDelayMs?(error: unknown): number | null;
}
/** One read at a time. Hidden or disposed reads may finish, but never publish a value. */
export class VisiblePolling<T> {
  private active = false;
  private generation = 0;
  private failures = 0;
  private hintedDelay = 0;
  private timer: unknown = undefined;
  private abort: AbortController | null = null;
  private pending: Promise<void> | null = null;
  private queuedRefresh: { promise: Promise<void>; resolve: () => void } | null = null;
  private unsubscribe: (() => void) | null = null;
  constructor(private readonly options: VisiblePollingOptions<T>, private readonly environment: PollingEnvironment) {
    if(!Number.isFinite(options.intervalMs) || options.intervalMs<=0 || (options.maxBackoffMs!==undefined && (!Number.isFinite(options.maxBackoffMs) || options.maxBackoffMs<options.intervalMs)))throw new Error("Invalid polling cadence");
  }
  start() {
    if(this.active)return;
    this.active=true;
    this.unsubscribe=this.environment.subscribe(()=>{
      if(!this.environment.visible()) {
        this.clearTimer(); this.generation++; this.abort?.abort(); this.cancelQueuedRefresh();
      } else { void this.refresh(); }
    });
    if(this.environment.visible())void this.refresh();
  }
  private clearTimer() { if(this.timer!==undefined){this.environment.cancel(this.timer);this.timer=undefined;} }
  private cancelQueuedRefresh() { this.queuedRefresh?.resolve();this.queuedRefresh=null; }
  refresh(): Promise<void> {
    if(!this.active)return Promise.resolve();
    // A deliberate manual refresh is allowed while hidden; background timers are not.
    this.clearTimer();
    if(this.pending){
      if(!this.queuedRefresh){
        let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});
        this.queuedRefresh={promise,resolve};this.generation++;this.abort?.abort();
      }
      return this.queuedRefresh.promise;
    }
    const generation=++this.generation, controller=new AbortController();this.abort=controller;
    const current=()=>this.active && generation===this.generation && !controller.signal.aborted;
    this.pending=Promise.resolve().then(()=>{if(!current())throw new DOMException("Polling scope stopped","AbortError");return this.options.read(controller.signal);}).then(value=>{
      if(!current())return;this.failures=0;this.hintedDelay=0;this.options.onValue(value);
    }).catch(error=>{
      if(!current())return;this.failures=Math.min(this.failures+1,20);this.hintedDelay=this.options.retryDelayMs?.(error) ?? 0;
      try{this.options.onError(error);}catch{/* A consumer error must not create an unhandled background rejection. */}
    }).finally(()=>{
      this.pending=null;if(this.abort===controller)this.abort=null;
      if(!this.active){this.cancelQueuedRefresh();return;}
      if(this.queuedRefresh){const queued=this.queuedRefresh;this.queuedRefresh=null;return this.refresh().then(queued.resolve);}
      if(this.environment.visible()){
        const maximum=this.options.maxBackoffMs ?? Math.max(this.options.intervalMs,300_000);
        const delay=Math.max(Math.min(maximum,this.options.intervalMs * 2 ** this.failures),this.hintedDelay);
        this.timer=this.environment.schedule(()=>{this.timer=undefined;if(this.active && this.environment.visible())void this.refresh();},delay);
      }
    });
    return this.pending;
  }
  stop() { this.active=false;this.generation++;this.clearTimer();this.abort?.abort();this.cancelQueuedRefresh();this.unsubscribe?.();this.unsubscribe=null; }
}
