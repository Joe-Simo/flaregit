import {test,expect} from 'bun:test';
import {runtimeRelease} from '../src/server/runtime-release';
const worker='3480027c-e83e-4227-8818-72f15b25e0e6',source='a'.repeat(40);
test('identifies actual server-bound worker and source versions',()=>{expect(runtimeRelease({CF_VERSION_METADATA:{id:worker},FLAREGIT_SOURCE_VERSION:source})).toEqual({workerVersion:worker,sourceVersion:source,releaseIdentified:true});});
test('missing or malformed identities remain explicit null',()=>{expect(runtimeRelease({})).toEqual({workerVersion:null,sourceVersion:null,releaseIdentified:false});for(const invalid of ['secret',0,{},'0'.repeat(40),'a'.repeat(39)])expect(runtimeRelease({CF_VERSION_METADATA:{id:invalid},FLAREGIT_SOURCE_VERSION:invalid})).toEqual({workerVersion:null,sourceVersion:null,releaseIdentified:false});expect(runtimeRelease({CF_VERSION_METADATA:{id:worker}}).releaseIdentified).toBe(false);});
test('tags and arbitrary metadata never reach output',()=>{const result=runtimeRelease({CF_VERSION_METADATA:{id:worker,tag:'secret-token',timestamp:{secret:'hidden'}},FLAREGIT_SOURCE_VERSION:source});expect(Object.keys(result)).toEqual(['workerVersion','sourceVersion','releaseIdentified']);expect(JSON.stringify(result)).not.toContain('secret');});

test('optional request release fence rejects partial, stale and unidentified pins before operations',async()=>{
 const {runtimeReleaseRequestMatches}=await import('../src/server/runtime-release');
 const worker=crypto.randomUUID(),source='a'.repeat(40),env={CF_VERSION_METADATA:{id:worker},FLAREGIT_SOURCE_VERSION:source};
 const request=(headers:Record<string,string>)=>new Request('https://owned.example/api/runtime',{headers});
 expect(runtimeReleaseRequestMatches(request({}),{})).toBe(true);
 expect(runtimeReleaseRequestMatches(request({'X-FlareGit-Expected-Worker-Version':worker}),env)).toBe(false);
 expect(runtimeReleaseRequestMatches(request({'X-FlareGit-Expected-Worker-Version':worker,'X-FlareGit-Expected-Source-Version':source}),env)).toBe(true);
 expect(runtimeReleaseRequestMatches(request({'X-FlareGit-Expected-Worker-Version':crypto.randomUUID(),'X-FlareGit-Expected-Source-Version':source}),env)).toBe(false);
 expect(runtimeReleaseRequestMatches(request({'X-FlareGit-Expected-Worker-Version':worker,'X-FlareGit-Expected-Source-Version':'b'.repeat(40)}),env)).toBe(false);
 expect(runtimeReleaseRequestMatches(request({'X-FlareGit-Expected-Worker-Version':worker,'X-FlareGit-Expected-Source-Version':source}),{})).toBe(false);
});
