import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
test('cancelled destination bytes retain unknown holds, preserve source/shared objects and never revive cancelled IDs',async()=>{
 if(await workerdChild('tests/issue-transfer-cancellation-bytes-http.test.ts'))return;
 const built=await Bun.build({entrypoints:['tests/support/issue-transfer-bytes-worker.ts'],target:'browser',external:['cloudflare:workers','node:*']});if(!built.success)throw Error(built.logs.join('\n'));
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'transfer-cancel-bytes',modules:true,script:await built.outputs[0]!.text(),compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{BYTES:{className:'TransferByteFixture',useSQLite:true}},r2Buckets:{BUCKET:'cancel-real-bytes'}}]}));
 try{const worker=await mf.getWorker('transfer-cancel-bytes');for(const scenario of ['cleanup','cleanup-late-put','cleanup-delete-ack','cleanup-overlap','cleanup-shared']){
  const response=await worker.fetch('http://fixture/?scenario='+scenario);expect(response.status).toBe(200);
  const result=await response.json() as {first:{physicalCleanup:string;deletedObjects:number;sharedObjectsRetained:number};second?:{physicalCleanup:string};overlap?:{physicalCleanup:string};sourceBytes:number[];sharedBytes?:number[];phase:string;recreateDenied:boolean;inspection:{unchanged:boolean;result:{physicalCleanup:string;sharedObjectsRetained:number}}};
  expect(result.sourceBytes).toEqual([0,255,128,10,13,42]);expect(result.phase).toBe('removed');expect(result.recreateDenied).toBe(true);expect(result.inspection.unchanged).toBe(true);expect(result.inspection.result.physicalCleanup).toBe(scenario==='cleanup-delete-ack'?'pending':'confirmed');if(scenario==='cleanup-shared')expect(result.inspection.result.sharedObjectsRetained).toBe(1);
  if(scenario==='cleanup-late-put'){expect(result.first.physicalCleanup).toBe('pending');expect(result.second?.physicalCleanup).toBe('confirmed');}
  else if(scenario==='cleanup-delete-ack'){expect(result.first.physicalCleanup).toBe('pending');expect(result.second?.physicalCleanup).toBe('pending');expect(result.first.deletedObjects).toBe(0);}
  else{expect(result.first.physicalCleanup).toBe('confirmed');if(scenario==='cleanup-overlap')expect(result.overlap?.physicalCleanup).toBe('pending');if(scenario==='cleanup-shared'){expect(result.sharedBytes).toEqual(result.sourceBytes);expect(result.first.sharedObjectsRetained).toBe(1);expect(result.first.deletedObjects).toBe(0);}else expect(result.first.deletedObjects).toBe(1);}
 }}finally{await mf.dispose();}
},60000);
