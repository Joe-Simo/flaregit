import {test,expect} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
import type {C02NetworkProbePlan,C02NetworkReceiverReceipt} from '../src/server/c02-network-probe';

test('actual owned receiver Worker authorizes registration and durably attributes network nonces without changing delivery receipts',async()=>{
 if(await workerdChild('tests/c02-network-receiver-worker.test.ts','actual owned receiver Worker authorizes registration and durably attributes network nonces without changing delivery receipts'))return;
 const build=await Bun.build({entrypoints:['fixtures/delivery-verifier/worker.ts'],target:'browser',external:['cloudflare:workers']});if(!build.success)throw Error(build.logs.join('\n'));
 const control=crypto.randomUUID(),networkControl=crypto.randomUUID(),secret=crypto.getRandomValues(new Uint8Array(24)),host='http://flaregit-owned-delivery-verifier.simo-988.workers.dev';
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'network-receiver-http-local-not-hosted-proof',unsafeDirectSockets:[{host:'127.0.0.1'}],modules:true,script:await build.outputs[0]!.text(),compatibilityDate:'2026-10-04',bindings:{CONTROL_SECRET:control,C02_RECEIVER_CONTROL_SECRET:networkControl,WEBHOOK_SECRET:`whsec_${Buffer.from(secret).toString('base64')}`,EXPECTED_PROJECT:'p123456789abc'},durableObjects:{RECEIPTS:{className:'DeliveryReceipts',useSQLite:true},NETWORK_RECEIPTS:{className:'NetworkReceipts',useSQLite:true}}}]}));
 // Exercise the actual local HTTP socket. The canonical Host remains part of
 // the receiver's origin/path check; this is not public HTTP reachability proof.
 const directUrl=await mf.unsafeGetDirectURL('network-receiver-http-local-not-hosted-proof');
 const request=async(path:string,init?:RequestInit)=>{const headers=new Headers(init?.headers);headers.set('Connection','close');headers.set('Host',new URL(host).hostname);const response=await fetch(new URL(path,directUrl),{...init,headers}),body=await response.text();return{status:response.status,json:():unknown=>JSON.parse(body)};};
 const operator={Authorization:`Bearer ${control}`},networkOperator={Authorization:`Bearer ${networkControl}`};
 try{
  const payload=JSON.stringify({id:'evt_network_preservation',type:'deployment.requested',project:{id:'p123456789abc',name:'Never retain this name'},data:{commit:'a'.repeat(40),tree:'b'.repeat(40),recoverableRef:'refs/flaregit/deployments/network-test'}}),timestamp=String(Math.floor(Date.now()/1000)),delivery='dlv_network-preservation';
  const key=await crypto.subtle.importKey('raw',secret,{name:'HMAC',hash:'SHA-256'},false,['sign']),signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${delivery}.${timestamp}.${payload}`))).toString('base64');
  const delivered=await request('/webhook',{method:'POST',headers:{'webhook-id':delivery,'webhook-timestamp':timestamp,'webhook-signature':`v1,${signature}`,'webhook-sequence':'1'},body:payload});expect(delivered.status).toBe(503);
  const before=(await request('/report',{headers:operator})).json();expect(before).toMatchObject({evidence:'owned-receiver-only',deploymentExecuted:false,actions:[{event_id:'evt_network_preservation'}],deliveries:[{receipts:1}]});
  const createdAt=Date.now(),scope={requestId:crypto.randomUUID(),instanceId:'registered-instance-network-test',probeId:crypto.randomUUID()},endpoint={channel:'http' as const,receiverId:'flaregit-owned-network-v1',url:host+'/c02-network/observe',controlNonce:'1'.repeat(64),probeNonce:'2'.repeat(64)},plan:C02NetworkProbePlan={scope,createdAt,deadlineAt:createdAt+120000,maxContainers:1,maxNativeSeconds:120,endpoints:[endpoint]};
  const query=new URLSearchParams(scope),receiptsPath='/c02-network/receipts?'+query;
  expect((await request('/c02-network/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(plan)})).status).toBe(401);
  expect((await request('/c02-network/register',{method:'POST',headers:{...operator,'Content-Type':'application/json'},body:JSON.stringify(plan)})).status).toBe(401);
  expect((await request('/report',{headers:networkOperator})).status).toBe(401);
  expect((await request(receiptsPath,{headers:networkOperator})).status).toBe(400);
  expect((await request('/c02-network/register',{method:'POST',headers:{...networkOperator,'Content-Type':'application/json'},body:JSON.stringify(plan)})).status).toBe(200);
  expect((await request('/c02-network/register',{method:'POST',headers:{...networkOperator,'Content-Type':'application/json'},body:JSON.stringify(plan)})).status).toBe(200);
  expect((await request(receiptsPath)).status).toBe(401);
  const observed=async(nonce:string,extra?:Record<string,string>)=>request('/c02-network/observe?'+new URLSearchParams({...scope,channel:'http',nonce,...extra}));
  expect((await observed('3'.repeat(64))).status).toBe(400);
  expect((await observed(endpoint.controlNonce,{instanceId:'foreign-instance'})).status).toBe(400);
  const controlResponse=await observed(endpoint.controlNonce);expect(controlResponse.status).toBe(200);const first=controlResponse.json() as {receipt:C02NetworkReceiverReceipt};expect(first.receipt).toMatchObject({scope,channel:'http',receiverId:endpoint.receiverId,kind:'control',nonce:endpoint.controlNonce,source:'owned-receiver'});expect(first.receipt.receivedAt).toBeGreaterThanOrEqual(createdAt);
  expect((await observed(endpoint.controlNonce)).json()).toEqual(controlResponse.json());
  const probeResponse=await observed(endpoint.probeNonce);expect(probeResponse.status).toBe(200);expect(probeResponse.json()).toMatchObject({receipt:{scope,kind:'native-probe',nonce:endpoint.probeNonce}});
  expect((await observed(endpoint.probeNonce)).json()).toEqual(probeResponse.json());
  const stored=(await request(receiptsPath,{headers:networkOperator})).json() as {receipts:C02NetworkReceiverReceipt[]};expect(stored.receipts).toHaveLength(2);expect(stored.receipts).toEqual([first.receipt,(probeResponse.json() as {receipt:C02NetworkReceiverReceipt}).receipt]);
  expect((await request('/c02-network/register',{method:'POST',headers:{...networkOperator,'Content-Type':'application/json'},body:JSON.stringify({...plan,scope:{...scope,probeId:crypto.randomUUID()}})})).status).toBe(400);
  expect((await request(receiptsPath,{headers:networkOperator})).json()).toEqual(stored);
  expect((await request('/report',{headers:operator})).json()).toEqual(before);
 }finally{await mf.dispose();}
},30000);

test('actual owned network receiver refuses both secrets when dedicated network secret is missing',async()=>{
 const name='actual owned network receiver refuses both secrets when dedicated network secret is missing';if(await workerdChild('tests/c02-network-receiver-worker.test.ts',name))return;
 const build=await Bun.build({entrypoints:['fixtures/delivery-verifier/worker.ts'],target:'browser',external:['cloudflare:workers']});if(!build.success)throw Error(build.logs.join('\n'));
 const control=crypto.randomUUID(),networkControl=crypto.randomUUID(),hostname='flaregit-owned-delivery-verifier.simo-988.workers.dev',mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'network-receiver-missing-secret-local',unsafeDirectSockets:[{host:'127.0.0.1'}],modules:true,script:await build.outputs[0]!.text(),compatibilityDate:'2026-10-04',bindings:{CONTROL_SECRET:control,WEBHOOK_SECRET:`whsec_${Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64')}`,EXPECTED_PROJECT:'p123456789abc'},durableObjects:{RECEIPTS:{className:'DeliveryReceipts',useSQLite:true},NETWORK_RECEIPTS:{className:'NetworkReceipts',useSQLite:true}}}]}));
 try{const direct=await mf.unsafeGetDirectURL('network-receiver-missing-secret-local'),createdAt=Date.now(),scope={requestId:crypto.randomUUID(),instanceId:'missing-network-secret-instance',probeId:crypto.randomUUID()},endpoint={channel:'http' as const,receiverId:'flaregit-owned-network-v1',url:`http://${hostname}/c02-network/observe`,controlNonce:'3'.repeat(64),probeNonce:'4'.repeat(64)},plan:C02NetworkProbePlan={scope,createdAt,deadlineAt:createdAt+120000,maxContainers:1,maxNativeSeconds:120,endpoints:[endpoint]};
 const request=async(path:string,init?:RequestInit)=>{const headers=new Headers(init?.headers);headers.set('Host',hostname);headers.set('Connection','close');const response=await fetch(new URL(path,direct),{...init,headers});await response.text();return response.status;};
 for(const supplied of [control,networkControl]){expect(await request('/c02-network/register',{method:'POST',headers:{Authorization:`Bearer ${supplied}`,'Content-Type':'application/json'},body:JSON.stringify(plan)})).toBe(401);expect(await request('/c02-network/receipts?'+new URLSearchParams(scope),{headers:{Authorization:`Bearer ${supplied}`}})).toBe(401);}
 expect(await request('/c02-network/observe?'+new URLSearchParams({...scope,channel:'http',nonce:endpoint.controlNonce}))).toBe(400);
 expect(await request('/report',{headers:{Authorization:`Bearer ${control}`}})).toBe(200);
 expect(await request('/report',{headers:{Authorization:`Bearer ${networkControl}`}})).toBe(401);
 }finally{await mf.dispose();}
},30000);
