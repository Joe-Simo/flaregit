import {afterEach,beforeEach,expect,test} from 'bun:test';
import {replayWebhookDelivery,webhookMutationIsCurrent} from '../src/web/components/WebhooksCard';
import {bindApiSession} from '../src/web/api';
test('webhook mutation outcome cannot appear for a replacement actor or unmounted view',()=>{
 const release=bindApiSession('first-owner',async()=> 'synthetic');
 expect(webhookMutationIsCurrent(2,2,'first-owner')).toBe(true);
 expect(webhookMutationIsCurrent(2,3,'first-owner')).toBe(false);
 const releaseOther=bindApiSession('other-owner',async()=> 'synthetic');
 expect(webhookMutationIsCurrent(2,2,'first-owner')).toBe(false);
 expect(webhookMutationIsCurrent(2,2,'other-owner')).toBe(true);
 expect(webhookMutationIsCurrent(2,2,null)).toBe(false);releaseOther();release();
});
const originalFetch=globalThis.fetch;
let releaseSession:(()=>void)|undefined;
beforeEach(()=>{releaseSession=bindApiSession('fixture-owner',async()=> 'synthetic');});
afterEach(()=>{globalThis.fetch=originalFetch;releaseSession?.();});

test('unknown replay acknowledgement refreshes saved delivery without another replay',async()=>{
 const requests:string[]=[]; const lost=new Error('Lost replay acknowledgement'); let refreshes=0;
 globalThis.fetch=Object.assign(async(url:string|URL|Request,init?:RequestInit)=>{requests.push(`${init?.method} ${url}`);throw lost;},{preconnect:originalFetch.preconnect});
 try {await replayWebhookDelivery('p123456789abc','dlv_original',async()=>{refreshes++;});throw Error('Expected unknown acknowledgement');}catch(error){expect(error).toBe(lost);}
 expect(requests).toEqual(['POST /api/p/p123456789abc/deliveries/dlv_original/redeliver']); expect(refreshes).toBe(1);
});
test('failed reconciliation preserves original replay failure',async()=>{
 const lost=new Error('Replay was saved but dispatch is unavailable');
 globalThis.fetch=Object.assign(async()=>{throw lost;},{preconnect:originalFetch.preconnect});
 await expect(replayWebhookDelivery('p123456789abc','dlv_original',async()=>{throw Error('Read failed');})).rejects.toBe(lost);
});
test('confirmed replay leaves success refresh to the mutation guard',async()=>{
 let refreshes=0;globalThis.fetch=Object.assign(async()=>Response.json({recorded:'dlv_original'}),{preconnect:originalFetch.preconnect});
 await replayWebhookDelivery('p123456789abc','dlv_original',async()=>{refreshes++;});expect(refreshes).toBe(0);
});
test('explicit original replay retries send the identical UUID and base generation',async()=>{
 const request={idempotencyKey:'12345678-1234-4234-8234-123456789abc',expectedGeneration:4},bodies:unknown[]=[];
 globalThis.fetch=Object.assign(async(_url:string|URL|Request,init?:RequestInit)=>{bodies.push(JSON.parse(String(init?.body)));throw Error('Lost ACK');},{preconnect:originalFetch.preconnect});
 for(let attempt=0;attempt<2;attempt++)await expect(replayWebhookDelivery('p123456789abc','dlv_original',async()=>{},request)).rejects.toThrow('Lost ACK');
 expect(bodies).toEqual([request,request]);
});
