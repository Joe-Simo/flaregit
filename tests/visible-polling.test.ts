import {expect,test} from "bun:test";
import {VisiblePolling,type PollingEnvironment} from "../src/web/visible-polling";
function fixture(){
  let visible=true,listener:(()=>void)|null=null,id=0;
  const timers=new Map<number,{callback:()=>void;delay:number}>();
  const environment:PollingEnvironment={visible:()=>visible,subscribe(next){listener=next;return()=>{listener=null;};},schedule(callback,delay){const handle=++id;timers.set(handle,{callback,delay});return handle;},cancel(handle){if(typeof handle==="number")timers.delete(handle);}};
  return {environment,timers,setVisible(value:boolean){visible=value;listener?.();},focus(){listener?.();},fire(){const next=timers.entries().next().value;if(!next)throw new Error("Expected scheduled poll");timers.delete(next[0]);next[1].callback();},delay(){return timers.values().next().value?.delay;}};
}
const flush=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

test("hidden tabs do not start or schedule background reads; manual reads remain available",async()=>{
  const f=fixture();f.setVisible(false);let reads=0;const values:number[]=[];
  const poll=new VisiblePolling({intervalMs:8000,read:async()=>++reads,onValue:value=>values.push(value),onError:()=>{}},f.environment);poll.start();await flush();expect(reads).toBe(0);expect(f.timers.size).toBe(0);
  await poll.refresh();expect(reads).toBe(1);expect(values).toEqual([1]);expect(f.timers.size).toBe(0);
  f.setVisible(true);await flush();expect(reads).toBe(2);expect(f.delay()).toBe(8000);poll.stop();expect(f.timers.size).toBe(0);
});
test("focus and manual refresh coalesce one fresh queued request without overlapping reads",async()=>{
  const f=fixture(),request=deferred<number>();let reads=0;const values:number[]=[];
  const poll=new VisiblePolling({intervalMs:6000,read:()=>{reads++;return reads===1?request.promise:Promise.resolve(43);},onValue:value=>values.push(value),onError:()=>{}},f.environment);poll.start();await flush();f.focus();const pending=poll.refresh();await flush();expect(reads).toBe(1);
  request.resolve(42);await pending;expect(values).toEqual([43]);expect(reads).toBe(2);expect(f.timers.size).toBe(1);expect(f.delay()).toBe(6000);poll.stop();
});
test("hide aborts and suppresses delayed results; visibility resumes only after that request settles",async()=>{
  const f=fixture(),first=deferred<number>();let reads=0;let signal:AbortSignal|undefined;const values:number[]=[];
  const poll=new VisiblePolling({intervalMs:8000,read:next=>{signal=next;reads++;return reads===1?first.promise:Promise.resolve(2);},onValue:value=>values.push(value),onError:()=>{}},f.environment);poll.start();await flush();f.setVisible(false);expect(signal?.aborted).toBe(true);f.setVisible(true);await flush();expect(reads).toBe(1);
  first.resolve(1);await flush();expect(reads).toBe(2);expect(values).toEqual([2]);expect(f.delay()).toBe(8000);poll.stop();
});
test("failures back off to a fixed bound and successful reads restore normal cadence",async()=>{
  const f=fixture();let failure=true;const errors:unknown[]=[];
  const poll=new VisiblePolling({intervalMs:1000,maxBackoffMs:4000,read:async()=>{if(failure)throw new Error("Unavailable");return "current";},onValue:()=>{},onError:error=>errors.push(error)},f.environment);poll.start();await flush();expect(f.delay()).toBe(2000);f.fire();await flush();expect(f.delay()).toBe(4000);f.fire();await flush();expect(f.delay()).toBe(4000);expect(errors.length).toBe(3);
  failure=false;f.fire();await flush();expect(f.delay()).toBe(1000);poll.stop();
});
test("disposed scopes never deliver pending values/errors or schedule another poll",async()=>{
  const f=fixture(),request=deferred<number>();const values:number[]=[],errors:unknown[]=[];let reads=0;
  const poll=new VisiblePolling({intervalMs:8000,read:()=>{reads++;return reads===1?request.promise:Promise.resolve(43);},onValue:value=>values.push(value),onError:error=>errors.push(error)},f.environment);poll.start();await flush();poll.stop();request.reject(new Error("Old repository failed"));await flush();expect(values).toEqual([]);expect(errors).toEqual([]);expect(f.timers.size).toBe(0);await poll.refresh();expect(reads).toBe(1);
});
test("stopping before the queued read dispatches does not call its loader",async()=>{
  const f=fixture();let reads=0;
  const poll=new VisiblePolling({intervalMs:8000,read:async()=>++reads,onValue:()=>{throw new Error("Disposed read delivered");},onError:()=>{throw new Error("Disposed error delivered");}},f.environment);poll.start();poll.stop();await flush();expect(reads).toBe(0);expect(f.timers.size).toBe(0);
});
test("a fresh visible focus refresh replaces its timer, while replacement scope ignores the old result",async()=>{
  const f=fixture(),old=deferred<string>();const delivered:string[]=[];
  const first=new VisiblePolling({intervalMs:6000,read:()=>old.promise,onValue:value=>delivered.push(value),onError:()=>{}},f.environment);first.start();await flush();first.stop();
  let reads=0;const replacement=new VisiblePolling({intervalMs:6000,read:async()=>`new-${++reads}`,onValue:value=>delivered.push(value),onError:()=>{}},f.environment);replacement.start();await flush();old.resolve("old candidate");await flush();expect(delivered).toEqual(["new-1"]);expect(f.timers.size).toBe(1);
  f.focus();await flush();expect(delivered).toEqual(["new-1","new-2"]);expect(f.timers.size).toBe(1);replacement.stop();
});
test("manual refresh after a mutation waits for fresh data and suppresses the earlier GET",async()=>{
  const f=fixture(),old=deferred<string>(),fresh=deferred<string>();let reads=0,resolved=false;const values:string[]=[];
  const poll=new VisiblePolling({intervalMs:10000,read:()=>++reads===1?old.promise:fresh.promise,onValue:value=>values.push(value),onError:()=>{}},f.environment);poll.start();await flush();
  // A successful mutation has completed here, while the previous GET is still pending.
  const refreshed=poll.refresh();const sameQueuedRefresh=poll.refresh();expect(sameQueuedRefresh).toBe(refreshed);void refreshed.then(()=>{resolved=true;});await flush();expect(reads).toBe(1);
  old.resolve("before mutation");await flush();expect(reads).toBe(2);expect(values).toEqual([]);expect(resolved).toBe(false);
  fresh.resolve("after mutation");await refreshed;expect(values).toEqual(["after mutation"]);expect(resolved).toBe(true);expect(f.timers.size).toBe(1);poll.stop();
});
test("scope disposal settles queued manual refresh without dispatching a replacement read",async()=>{
  const f=fixture(),old=deferred<string>();let reads=0;const values:string[]=[];
  const poll=new VisiblePolling({intervalMs:10000,read:()=>{reads++;return old.promise;},onValue:value=>values.push(value),onError:()=>{}},f.environment);poll.start();await flush();const queued=poll.refresh();poll.stop();await queued;old.resolve("old scope");await flush();expect(reads).toBe(1);expect(values).toEqual([]);expect(f.timers.size).toBe(0);
});
