import {test,expect} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
const modes=['command-custom','command-git-integrity','git-integrity'] as const;
test('native verification closure requires the verifier identity of the candidate policy',async()=>{
 if(await workerdChild('tests/verification-closure-identity.test.ts'))return;
 const file=`/tmp/closure-identity-${crypto.randomUUID()}.js`,build=Bun.spawn([process.execPath,'build','tests/support/verification-closure-identity-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*','--outfile='+file],{stdout:'ignore',stderr:'pipe'});
 if(await build.exited)throw Error(await new Response(build.stderr).text());
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:modes.map(name=>({name,modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{REPOSITORY_CONTROLLER:{className:'VerificationClosureIdentityFixture',useSQLite:true}}}))}));
 try{
  const run=async(mode:typeof modes[number])=>await(await(await mf.getWorker(mode)).fetch('http://fixture/'+mode)).json() as {ok:boolean;error?:string;closures:number};
  expect(await run('command-custom')).toEqual({ok:true,closures:1});
  expect(await run('command-git-integrity')).toEqual({ok:false,error:'Exact native verification evidence required for phase closure',closures:0});
  expect(await run('git-integrity')).toEqual({ok:true,closures:1});
 }finally{await mf.dispose();}
},120000);
