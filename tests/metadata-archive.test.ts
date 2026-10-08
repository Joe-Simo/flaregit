import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {MetadataArchive} from '../src/server/metadata-archive';

test('native Git transfer and owner metadata restore preserve content, privacy and retry identity',async()=>{
 if(await workerdChild('tests/metadata-archive.test.ts'))return;
 const directory=await mkdtemp(join(tmpdir(),'flaregit-archive-'));
 const git=async(args:string[])=>{const result=Bun.spawn(['git',...args],{cwd:directory,stdout:'pipe',stderr:'pipe',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_TERMINAL_PROMPT:'0'}});const output=await new Response(result.stdout).text();if(await result.exited)throw Error(await new Response(result.stderr).text());return output.trim();};
 let mf:Miniflare|undefined;
 try{
 await git(['init','--quiet','source']);await Bun.write(join(directory,'source','readme.txt'),'Actual Git source\n');await git(['-C','source','add','.']);await git(['-C','source','-c','user.name=Owner','-c','user.email=owner@example.test','commit','--quiet','-m','source']);
 const head=await git(['-C','source','rev-parse','HEAD']);await git(['-C','source','bundle','create',join(directory,'history.bundle'),'--all']);await git(['clone','--quiet',join(directory,'history.bundle'),'destination']);expect(await git(['-C','destination','rev-parse','HEAD'])).toBe(head);expect(await Bun.file(join(directory,'destination','readme.txt')).text()).toBe('Actual Git source\n');
 const build=await Bun.build({entrypoints:['tests/support/metadata-archive-worker.ts'],target:'browser',external:['cloudflare:workers','node:crypto']});if(!build.success)throw Error(String(build.logs));
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'archive-test',modules:true,script:await build.outputs[0]!.text(),compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{TEST:{className:'MetadataArchiveFixture',useSQLite:true},REPOSITORY_CONTROLLER:{className:'MetadataArchiveFixture',useSQLite:true}},queueProducers:['INTEGRATION_QUEUE']}]}));
 const worker=await mf.getWorker('archive-test');const request=(path:string,name:string,body?:unknown,actor='owner')=>worker.fetch(`http://test${path}?name=${name}&actor=${actor}`,body?{method:'POST',body:JSON.stringify(body)}:undefined);
 const project=(id:string)=>({projectId:id,projectName:id,canonicalRepoName:id,policyVersion:1,verificationPolicy:{},decisions:{},evidence:{},acceptedState:{currentCommit:head,buildDigest:'build',activeRequirements:[],history:[]},tasks:{},candidates:{},journal:[]});
 for(const name of ['source','destination','conflict','rollback','large','expiry'])expect((await request('/seed',name,project(name))).status).toBe(200);
 await request('/data','source');await request('/content','source');await request('/data','conflict');
 expect((await request('/export','source',undefined,'outsider')).status).toBe(409);
 const response=await request('/export','source',undefined,'member');if(response.status!==200)throw Error(await response.text());const bundle=await response.json() as {archive:MetadataArchive;sha256:string};expect(bundle.archive.tables.find(table=>table.name==='issues')?.rows).toHaveLength(1);
 const restore={...bundle,requestId:crypto.randomUUID()};expect((await request('/restore','destination',restore,'member')).status).toBe(409);
 const first=await request('/restore','destination',restore);if(first.status!==200)throw Error(await first.text());expect(first.status).toBe(200);const receipt=await first.json();expect(await(await request('/restore','destination',restore)).json()).toEqual(receipt);expect(await(await request('/count','destination')).json()).toEqual({count:1});const origin=await(await request('/issue','destination')).json() as {author:string;archiveOrigin:{sourceAuthor:string;identity:string;nativeUserId:null;archiveDigest:string}};expect(origin.author).toBe('Imported archive contributor (unverified)');expect(origin.archiveOrigin).toMatchObject({sourceAuthor:'owner',identity:'external-unverified',nativeUserId:null,archiveDigest:bundle.sha256});expect((await(await request('/history','destination')).json() as Array<{table_name:string}>).some(row=>row.table_name==='repository_private_discussion_entries')).toBe(true);const restored=await(await request('/export','destination')).json() as typeof bundle;expect(restored.archive.tables.find(table=>table.name==='wiki_revisions')?.rows[0]?.body).toBe('Original wiki');expect(restored.archive.tables.find(table=>table.name==='repository_planning')?.rows).toEqual(bundle.archive.tables.find(table=>table.name==='repository_planning')?.rows);
 expect((await request('/restore','conflict',restore)).status).toBe(409);
 expect((await request('/restore','rollback',{...restore,sha256:'0'.repeat(64)})).status).toBe(409);expect(await(await request('/count','rollback')).json()).toEqual({count:0});
 expect((await request('/restore','destination',{...restore,requestId:crypto.randomUUID()})).status).toBe(409);
 const broken=structuredClone(bundle.archive),wiki=broken.tables.find(table=>table.name==='wiki_revisions')!;wiki.rows.push({...wiki.rows[0]!});const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(broken)));const sha256=[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');expect((await request('/restore','rollback',{archive:broken,sha256,requestId:crypto.randomUUID()})).status).toBe(409);expect(await(await request('/count','rollback')).json()).toEqual({count:0});
 const large=structuredClone(bundle.archive);large.tables.find(table=>table.name==='wiki_revisions')!.rows[0]!.body='😀'.repeat(50000);const largeBytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(large)));const largeDigest=[...new Uint8Array(largeBytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');const largeRestore={archive:large,sha256:largeDigest,requestId:crypto.randomUUID()};expect(new TextEncoder().encode(JSON.stringify(largeRestore)).length).toBeGreaterThan(131072);expect((await request('/restore','large',largeRestore)).status).toBe(200);
 expect((await request('/expired-restore','expiry',restore)).status).toBe(409);expect(await(await request('/count','expiry')).json()).toEqual({count:0});
 expect((await request('/restore','rollback',{archive:'x'.repeat(8_002_000),sha256:bundle.sha256,requestId:crypto.randomUUID()})).status).toBe(413);
 }finally{if(mf)await mf.dispose();await rm(directory,{recursive:true,force:true});}
},30000);
