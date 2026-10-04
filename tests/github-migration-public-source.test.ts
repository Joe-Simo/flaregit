import {expect,test} from 'bun:test';
import {readPublicGithubRepositoryIdentity} from '../src/server/github-migration-reader';
const source='https://github.com/example/repository';
const metadata={id:123,node_id:'R_abc',private:false,html_url:source};
test('public GitHub identity discovery is funded and authorized without transmitting credentials',async()=>{
 const steps:string[]=[];const result=await readPublicGithubRepositoryIdentity(source,async()=>{steps.push('authorize');},async()=>{steps.push('fund');},async request=>{steps.push('fetch');const value=request as Request;expect(value.url).toBe('https://api.github.com/repos/example/repository');expect(value.headers.has('Authorization')).toBe(false);expect(value.redirect).toBe('manual');return Response.json(metadata);});expect(result).toEqual({repositoryId:'123',repositoryNodeId:'R_abc',sourceUrl:source});expect(steps.indexOf('fund')).toBeLessThan(steps.indexOf('fetch'));expect(steps.at(-1)).toBe('authorize');
});
test('private, recreated or malformed identities cannot enter staging',async()=>{
 for(const value of [{...metadata,private:true},{...metadata,html_url:'https://github.com/other/repository'},{...metadata,id:0},{...metadata,node_id:'invalid\n'}])await expect(readPublicGithubRepositoryIdentity(source,async()=>{},async()=>{},async()=>Response.json(value))).rejects.toThrow();
 for(const url of ['https://evil.test/example/repository','https://github.com/example/repository?token=secret','https://github.com/example/repository#fragment'])await expect(readPublicGithubRepositoryIdentity(url,async()=>{},async()=>{},async()=>{throw Error('must not dispatch');})).rejects.toThrow('Exact public GitHub source');
});
test('owner withdrawal after response withholds provider identity',async()=>{
 let allowed=true;await expect(readPublicGithubRepositoryIdentity(source,async()=>{if(!allowed)throw Error('withdrawn');},async()=>{},async()=>{allowed=false;return Response.json(metadata);})).rejects.toThrow();
});

test('every actual provider retry consumes another funded admission',async()=>{let admissions=0,requests=0;for(let retry=0;retry<2;retry++)await expect(readPublicGithubRepositoryIdentity(source,async()=>{},async()=>{admissions++;},async()=>{requests++;throw Error('Synthetic lost response');})).rejects.toThrow();expect(admissions).toBe(2);expect(requests).toBe(2);});
