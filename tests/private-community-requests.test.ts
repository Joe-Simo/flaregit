import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
test('private repository owner retains request history without enabling contributor reads or approvals',async()=>{
 if(await workerdChild('tests/private-community-requests.test.ts'))return;
 const output=`/tmp/flaregit-private-requests-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,'build','tests/support/private-community-requests-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*',`--outfile=${output}`],{stdout:'ignore',stderr:'pipe'});
 let script:string;
 try{if(await build.exited!==0)throw new Error(await new Response(build.stderr).text());script=await Bun.file(output).text();}finally{if(await Bun.file(output).exists())await Bun.file(output).delete();}
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'private-requests',modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{REPOSITORY_CONTROLLER:{className:'PrivateCommunityRequests',useSQLite:true}}}]}));
 try{
 const api=await mf.getWorker('private-requests');
 const seed=await api.fetch('http://test/seed');expect(seed.status).toBe(200);
 const saved=await seed.json() as {id:string};
 const owner=await api.fetch('http://test/owner');expect(owner.status).toBe(200);expect(await owner.json()).toMatchObject([{id:saved.id,status:'requested'}]);
 expect((await api.fetch('http://test/contributor')).status).toBe(409);
 expect((await api.fetch('http://test/outsider')).status).toBe(409);
 expect((await api.fetch(`http://test/approve?id=${saved.id}`)).status).toBe(409);
 expect(await(await api.fetch('http://test/owner')).json()).toMatchObject([{id:saved.id,status:'requested'}]);
 await api.fetch('http://test/delete-fence');
 expect((await api.fetch('http://test/owner')).status).toBe(409);
 }finally{await mf.dispose();}
},30000);
