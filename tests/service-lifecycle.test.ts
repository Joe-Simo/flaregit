import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
test('signed service metadata fences repository deletion, current owner authority and account lifecycle at release',async()=>{
 if(await workerdChild('tests/service-lifecycle.test.ts'))return;
 const built=await Bun.build({entrypoints:['tests/support/service-lifecycle-worker.ts'],target:'browser',external:['cloudflare:workers','node:*']});
 if(!built.success)throw new Error(built.logs.join('\n'));
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'service-lifecycle',modules:true,script:await built.outputs[0]!.text(),compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{TEST:{className:'ServiceLifecycleFixture',useSQLite:true}}}]}));
 try{
  const worker=await mf.getWorker('service-lifecycle');
  const read=async(path:string,name:string)=>(await worker.fetch(`http://test${path}?case=${name}`));
  for(const reason of ['delete','demote','account-deleting','race','outage']){
   const created=await(await read('/setup',reason)).json() as {secret:string};
   expect(await(await read('/config',reason)).json()).toMatchObject({secret:created.secret});
   expect(await(await read('/snapshot',reason)).json()).toMatchObject({commit:'a'.repeat(40),tree:'b'.repeat(40)});
   await read(`/${reason}`,reason);
   expect(await(await read('/config',reason)).json()).toBeNull();
   expect(await(await read('/snapshot',reason)).json()).toBeNull();
   expect((await read('/callback',reason)).status).toBe(409);
   expect(await(await read('/counts',reason)).json()).toEqual({receipts:0,comments:0});
   if(reason!=='delete'){
    await read('/restore',reason);
    expect(await(await read('/callback',reason)).json()).toMatchObject({kind:'applied'});
    expect(await(await read('/callback',reason)).json()).toMatchObject({kind:'duplicate'});
    expect(await(await read('/counts',reason)).json()).toEqual({receipts:1,comments:1});
   }
  }
  await read('/setup','callback-race');
  expect(await(await read('/config','callback-race')).json()).not.toBeNull();
  await read('/race','callback-race');
  expect((await read('/callback','callback-race')).status).toBe(409);
  expect(await(await read('/counts','callback-race')).json()).toEqual({receipts:0,comments:0});
 }finally{await mf.dispose();}
},30000);
