import { expect, test } from "bun:test";
import { checkedRepoRelease, checkedRepoTagOperation, repoTagIntent, readRepoVersionRecovery, saveRepoVersionRecovery } from "../src/web/repository-releases";
const projectId="p123456789abc",commit="a".repeat(40),tree="b".repeat(40),operationId="11111111-1111-4111-8111-111111111111";
const target={journalId:"accepted-journal",acceptedRef:"refs/heads/main",acceptedRootVersion:3,commit,tree};
const operation={operationId,name:"v1.0.0",sourceCommit:commit,sourceTree:tree,phase:"unknown",createdAt:0,cleanup:"not_reported",acceptedJournalId:target.journalId,acceptedRef:target.acceptedRef,acceptedRootVersion:3,nativeStopped:false,credentialsComplete:false,providerVerified:false,recovery:"reconcile_only"};
const release={scope:{id:"22222222-2222-4222-8222-222222222222",projectId,incarnation:"33333333-3333-4333-8333-333333333333",canonicalRepoName:"canonical",authorId:"maintainer",source:{name:"v1.0.0",tagOperationId:operationId,acceptedJournalId:target.journalId,acceptedRef:target.acceptedRef,acceptedRootVersion:3,commit,tree}},title:"Release",notes:"Literal <img src=x onerror=alert(1)>\nHuman notes",revision:1,phase:"draft",createdAt:"2026-10-04T00:00:00Z",updatedAt:"2026-10-04T00:00:00Z"};
test("release metadata remains readable without claiming a current native tag",()=>{
 const parsed=checkedRepoRelease(release,projectId);
 expect(parsed.notes).toBe(release.notes);
 expect(parsed.tag).toBeUndefined();
 expect(()=>checkedRepoRelease(release,"pabcdef123456")).toThrow();
});
test("published releases require their exact recorded Git object identity",()=>{
 expect(()=>checkedRepoRelease({...release,phase:"published"},projectId)).toThrow();
 const published={...release,phase:"published",publishedAt:"2026-10-04T01:00:00Z",publishedBy:"maintainer",tag:{object:commit,type:"commit",commit,tree}};
 expect(checkedRepoRelease(published,projectId).phase).toBe("published");
 expect(()=>checkedRepoRelease({...published,tag:{...published.tag,tree:"c".repeat(40)}},projectId)).toThrow();
});
test("unknown tag acknowledgements retain original request scope and cannot masquerade as confirmed",()=>{
 expect(checkedRepoTagOperation(operation).phase).toBe("unknown");
 expect(()=>checkedRepoTagOperation({...operation,phase:"confirmed"})).toThrow();
 expect(()=>checkedRepoTagOperation({...operation,recovery:"resume_prepared"})).toThrow();
 expect(()=>checkedRepoTagOperation(operation,{name:"different",target})).toThrow();
});
test("an uncertain tag request is never silently retargeted by edited form fields",()=>{
 const initial=repoTagIntent(null,"v1.0.0",target);
 const retried=repoTagIntent(initial,"v2.0.0",{...target,commit:"d".repeat(40)});
 expect(retried).toBe(initial);
 expect(retried.name).toBe("v1.0.0");
 expect(retried.target.commit).toBe(commit);
 expect(retried.requestId).toBe(initial.requestId);
});
test("baseline revision zero cannot masquerade as a reviewed journal",()=>{
 expect(checkedRepoTagOperation({...operation,acceptedJournalId:"baseline",acceptedRootVersion:0}).acceptedRootVersion).toBe(0);
 expect(()=>checkedRepoTagOperation({...operation,acceptedJournalId:"baseline",acceptedRootVersion:1})).toThrow();
 expect(()=>checkedRepoTagOperation({...operation,acceptedRootVersion:0})).toThrow();
 expect(checkedRepoRelease({...release,scope:{...release.scope,source:{...release.scope.source,acceptedJournalId:"baseline",acceptedRootVersion:0}}},projectId).scope.source.acceptedRootVersion).toBe(0);
 expect(()=>checkedRepoRelease({...release,scope:{...release.scope,source:{...release.scope.source,acceptedRootVersion:0}}},projectId)).toThrow();
 expect(()=>checkedRepoRelease({...release,scope:{...release.scope,source:{...release.scope.source,acceptedJournalId:"baseline",acceptedRootVersion:1}}},projectId)).toThrow();
});
test("browser recovery preserves original tag UUID only for its exact account session and repository",()=>{
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
 const intent=repoTagIntent(null,"v1.0.0",target),recovery={tagIntent:intent,editor:null,releaseIntent:null};
 expect(saveRepoVersionRecovery(storage,"maintainer:session-one",projectId,recovery)).toBe(true);
 expect(readRepoVersionRecovery(storage,"maintainer:session-one",projectId)?.tagIntent).toEqual(intent);
 expect(readRepoVersionRecovery(storage,"other:session-two",projectId)).toBeNull();
 expect(readRepoVersionRecovery(storage,"maintainer:session-one","pabcdef123456")).toBeNull();
 expect(saveRepoVersionRecovery(storage,"maintainer:session-one",projectId,{...recovery,tagIntent:{...intent,target:{...target,acceptedRootVersion:0}}})).toBe(false);
 expect(readRepoVersionRecovery(storage,"maintainer:session-one",projectId)?.tagIntent?.requestId).toBe(intent.requestId);
});
test("interrupted notes retain the exact editor revision and edit UUID",()=>{
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
 const savedRelease=checkedRepoRelease(release,projectId),savedOperation=checkedRepoTagOperation({...operation,phase:"confirmed",providerVerified:true,nativeStopped:true,credentialsComplete:true,observation:{object:commit,type:"commit",commit,tree}});
 const editor={release:savedRelease,operation:savedOperation,title:"Changed draft title",notes:"Literal <script> remains a note"};
 const intent={signature:JSON.stringify([projectId,savedRelease.scope.id,savedRelease.revision,savedOperation.operationId,editor.title,editor.notes]),id:savedRelease.scope.id,editId:"44444444-4444-4444-8444-444444444444"};
 expect(saveRepoVersionRecovery(storage,"maintainer:session-one",projectId,{tagIntent:null,editor,releaseIntent:intent})).toBe(true);
 const restored=readRepoVersionRecovery(storage,"maintainer:session-one",projectId);
 expect(restored?.editor?.notes).toBe(editor.notes);
 expect(restored?.editor?.release?.revision).toBe(1);
 expect(restored?.releaseIntent).toEqual(intent);
 expect(readRepoVersionRecovery(storage,"maintainer:other-session",projectId)).toBeNull();
});
