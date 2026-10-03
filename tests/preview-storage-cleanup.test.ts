import {expect,test} from "bun:test";
import {cleanupRepositoryCopies} from "../src/server/preview-storage-cleanup";
import type {Env} from "../src/server/env";
import type {Ledger} from "../src/server/durable-object";
import type {PreviewCopyPlan} from "../src/server/preview-storage-writers";
const projectId="p123456789abc",incarnation="11111111-1111-4111-8111-111111111111",commit="a".repeat(40),key=`builds/${projectId}/${commit}`;
function fixture(input:{unresolved?:boolean;foreign?:boolean;legacy?:boolean;legacyInventory?:boolean;untracked?:boolean;readFailure?:boolean;plan?:PreviewCopyPlan}={}){
 const events:string[]=[];const plan:PreviewCopyPlan=input.plan??{physicalKey:key,identity:{projectId,incarnation,commit,accountKey:"b".repeat(12)},keys:[input.foreign?"other-tenant/private.txt":`${key}/index.html`],bytes:3,kind:"preview"};
 const ledger={repositoryDeletionPending:async()=>true,previewCleanupScope:async()=>({projectId,incarnation,legacyEvidence:input.legacy??false,legacyInventory:input.legacyInventory??false})} as unknown as Ledger;
 const global={fencePreviewCleanup:async()=>[plan],previewCopyCleanupReady:async()=>!input.unresolved,nativeComputeStatus:async()=>null,finishPreviewCopyCleanup:async()=>{events.push("confirmed-release");}};
 const env={REPOSITORY_CONTROLLER:{idFromName:(name:string)=>name,get:()=>global},EVIDENCE_BUCKET:{delete:async(objectKey:string)=>{events.push(objectKey);},list:async()=>{if(input.readFailure)throw new Error("provider unavailable with secret diagnostic");return{objects:input.untracked?[{}]:[],truncated:false};}}} as unknown as Env;
 return{env,ledger,events};
}
test("strict manifest scope rejects foreign keys before any provider deletion",async()=>{const f=fixture({foreign:true});expect((await cleanupRepositoryCopies(f.env,f.ledger)).cleaned).toBe(false);expect(f.events).toEqual([]);});
test("unresolved PUT writer preserves copies and capacity",async()=>{const f=fixture({unresolved:true});const outcome=await cleanupRepositoryCopies(f.env,f.ledger);expect(outcome.recoveryAction).toBe("provider-reconciliation");expect(f.events).toEqual([]);});
test("confirmed scoped cleanup releases only recorded copies before empty inventory",async()=>{const f=fixture();expect((await cleanupRepositoryCopies(f.env,f.ledger)).cleaned).toBe(true);expect(f.events).toEqual([`${key}/index.html`,"confirmed-release"]);});
test("legacy or untracked inventory prevents final repository metadata deletion",async()=>{for(const mode of [{legacy:true},{untracked:true}]){const f=fixture(mode),outcome=await cleanupRepositoryCopies(f.env,f.ledger);expect(outcome.cleaned).toBe(false);expect(outcome.recoveryAction).toBe("provider-reconciliation");expect(f.events).not.toContain("evidence/legacy.json");}});
test("inventory outage yields safe retry details without provider diagnostic leakage",async()=>{const f=fixture({readFailure:true}),outcome=await cleanupRepositoryCopies(f.env,f.ledger);expect(outcome.recoveryAction).toBe("retry");expect(outcome.detail).not.toContain("secret");});

test("empty listing alone never clears legacy writer reconciliation",async()=>{const f=fixture({legacyInventory:true}),outcome=await cleanupRepositoryCopies(f.env,f.ledger);expect(outcome.cleaned).toBe(false);expect(outcome.recoveryAction).toBe("provider-reconciliation");expect(outcome.detail).toContain("even when the current listing is empty");expect(f.events).toEqual([]);});

test("multi-asset preview and scoped evidence plans pass strict validation",async()=>{
 const identity={projectId,incarnation,commit,accountKey:"b".repeat(12)};
 const preview:PreviewCopyPlan={physicalKey:key,identity,keys:[`${key}/assets/foo..js`,`${key}/index.html`],bytes:9,kind:"preview"};
 const evidenceKey=`evidence/${projectId}/${incarnation}/ev_12345678-abc.json`;
 const evidence:PreviewCopyPlan={physicalKey:evidenceKey,identity,keys:[evidenceKey],bytes:9,kind:"evidence",sha256:"c".repeat(64)};
 for(const plan of [preview,evidence]){const f=fixture({plan});expect((await cleanupRepositoryCopies(f.env,f.ledger)).cleaned).toBe(true);expect(f.events).toEqual([...plan.keys,"confirmed-release"]);}
});
