import {expect,test} from 'bun:test';
import {checkedTransferPreview,checkedTransferReceipt,transferRequest,persistTransferIntent,recoverTransferIntent} from '../src/web/issue-transfer-intent';
import {prepareIssueTransferCommand} from '../src/cli/issue-transfer-command';
const source='p123456789abc',destination='p123456789abd',incarnation='12345678-1234-4234-8234-123456789abc',requestId='22345678-1234-4234-8234-123456789abc';
export const transferPreviewFixture={manifestDigest:'a'.repeat(64),source:{projectId:source,incarnation,number:7,stateRevision:3},destination:{projectId:destination,incarnation,audience:'repository-members'},audienceVersion:'repository-members-v1',manifest:{issue:{title:'Transfer exact issue',body:'Private source'},comments:[{body:'Existing comment'}],features:{labels:['release']},attachments:[{name:'design.png',size:1024}]}};
test('transfer recovery is identity/issue scoped and preserves original digest, UUID and destination',()=>{
 const data=new Map<string,string>(),storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}},scope={identity:'owner',projectId:source,number:7},preview=checkedTransferPreview(transferPreviewFixture,source,7,destination),request=transferRequest(preview,requestId);
 persistTransferIntent(storage,scope,request);expect(recoverTransferIntent(storage,scope)).toEqual(request);expect(recoverTransferIntent(storage,{...scope,identity:'other'})).toBeNull();expect(recoverTransferIntent(storage,{...scope,number:8})).toBeNull();expect(()=>persistTransferIntent(storage,scope,{...request,expectedManifestDigest:'b'.repeat(64)})).toThrow('cannot change');
 const receipt={requestId,manifestDigest:request.expectedManifestDigest,audienceVersion:'repository-members-v1',source:{projectId:source,number:7},destination:{projectId:destination,number:12},phase:'copying',completed:false,audience:'repository-members'};
 expect(checkedTransferReceipt(receipt,source,7,request).phase).toBe('copying');for(const invalid of [{...receipt,manifestDigest:'b'.repeat(64)},{...receipt,destination:{projectId:source,number:12}},{...receipt,completed:true},{...receipt,audienceVersion:'public'}])expect(()=>checkedTransferReceipt(invalid,source,7,request)).toThrow();
});
test('CLI transfer preview is read-only and original manifest replay performs no fresh GET',async()=>{
 let reads=0;const read=async()=>{reads++;return transferPreviewFixture;},base={repositoryId:source,issue:'7',destination,confirmed:false};expect((await prepareIssueTransferCommand(base,read)).kind).toBe('preview');expect(reads).toBe(1);
 await expect(prepareIssueTransferCommand({...base,confirmed:true},read)).rejects.toThrow('--manifest');const original=await prepareIssueTransferCommand({...base,confirmed:true,manifest:transferPreviewFixture,request:requestId},read);expect(original.kind).toBe('dispatch');if(original.kind!=='dispatch')throw Error('Expected exact dispatch');expect(original.request).toMatchObject({requestId,expectedRevision:3,expectedManifestDigest:'a'.repeat(64),expectedDestinationIncarnation:incarnation});expect(reads).toBe(1);
 await expect(prepareIssueTransferCommand({...base,confirmed:true,manifest:transferPreviewFixture,destination:source,request:requestId},read)).rejects.toThrow('another');expect(reads).toBe(1);
});
test('transfer tombstone view exposes only fresh authorized destination and discards private body and arbitrary redirect',async()=>{
 const {readIssueViewResponse}=await import('../src/cli/issue-delete-command');expect(await readIssueViewResponse(Response.json({number:7,deleted:true,transferred:true,title:'private',body:'private',redirect:'https://foreign.example'},{status:410}),7)).toEqual({number:7,deleted:true,transferred:true});
 expect(await readIssueViewResponse(Response.json({number:7,deleted:true,transferred:true,transfer:{projectId:destination,number:12},body:'private'},{status:410}),7)).toEqual({number:7,deleted:true,transferred:true,transfer:{projectId:destination,number:12}});
 await expect(readIssueViewResponse(Response.json({number:8,deleted:true,transferred:true},{status:410}),7)).rejects.toThrow('not confirmed');
});
