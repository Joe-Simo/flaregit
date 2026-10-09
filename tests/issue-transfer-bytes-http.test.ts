import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
test('transfer bytes use real R2 streams, recover lost acknowledgements and refuse changed nonce or digest',async()=>{
 if(await workerdChild('tests/issue-transfer-bytes-http.test.ts'))return;
 const built=await Bun.build({entrypoints:['tests/support/issue-transfer-bytes-worker.ts'],target:'browser',external:['cloudflare:workers','node:*']});if(!built.success)throw Error(built.logs.join('\n'));
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'transfer-bytes',modules:true,script:await built.outputs[0]!.text(),compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{BYTES:{className:'TransferByteFixture',useSQLite:true}},r2Buckets:{BUCKET:'transfer-real-bytes'}}]}));
 try{const worker=await mf.getWorker('transfer-bytes');for(const scenario of ['success','lost-ack','nonce','digest','cancel']){const response=await worker.fetch('http://fixture/?scenario='+scenario);expect(response.status).toBe(200);const value=await response.json() as {receipt?:{verified:boolean};error?:string;cancelled:boolean;copied:number[]|null;source:{downloads:number};destination:{uploads:number;phase:string;attachmentPhase:string}};
 if(scenario==='success'||scenario==='lost-ack'){expect(value.receipt?.verified).toBe(true);expect(value.copied).toEqual([0,255,128,10,13,42]);expect(value.source.downloads).toBe(1);expect(value.destination.uploads).toBe(1);if(scenario==='lost-ack')expect(value.error).toContain('acknowledgement lost');}
 else{expect(value.receipt).toBeUndefined();expect(value.copied).toBeNull();expect(value.destination.attachmentPhase).toBe('pending');expect(value.error).toBeTruthy();if(scenario==='nonce'){expect(value.error).toContain('nonce');expect(value.cancelled).toBe(true);expect(value.destination.uploads).toBe(0);}else{expect(value.destination.phase).toBe('unknown');expect(value.destination.uploads).toBe(1);}if(scenario==='cancel')expect(value.cancelled).toBe(true);}
 }}finally{await mf.dispose();}
},60000);
