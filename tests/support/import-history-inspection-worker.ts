import {DurableObject} from "cloudflare:workers";
import {ImportHistoryInspection,type HistoryInspectionScope} from "../../src/server/import-history-inspection.js";
const hash=(n:number)=>n.toString(16).padStart(40,"0"),tree="f".repeat(40);
const scope:HistoryInspectionScope={operationId:"import-history-11111111-1111-4111-8111-111111111111",projectId:"p123456789abc",incarnation:"11111111-1111-4111-8111-111111111111",ownerId:"owner",accountKey:"a".repeat(12),canonicalRepoName:"flaregit-p123456789abc",source:"https://github.com/acme/repo.git",branch:"main",head:hash(2)};
export class HistoryInspectionFixture extends DurableObject {
 async run(mode:string){const ledger=new ImportHistoryInspection(this.ctx.storage);ledger.begin(scope);const batch=ledger.batch(scope.operationId,"source");const chunk={batchId:batch.batchId,revision:batch.revision,requested:batch.requested,commits:[{hash:hash(2),tree,parents:[hash(1)]},{hash:hash(1),tree,parents:[]}]};
  if(mode==="fault"){this.ctx.storage.sql.exec("CREATE TRIGGER fail_graph BEFORE INSERT ON history_nodes BEGIN SELECT RAISE(ABORT,'native graph fault'); END");try{await ledger.commit(scope.operationId,"source",chunk);}catch{/* Expected transaction rollback. */}return ledger.get(scope.operationId);}
  if(mode==="stale"){try{await ledger.commit(scope.operationId,"source",chunk,async()=>{},()=>{throw new Error("native stale actor");});}catch{/* Expected actor fence. */}return ledger.get(scope.operationId);}
  const first=await ledger.commit(scope.operationId,"source",chunk),replay=await ledger.commit(scope.operationId,"source",chunk);const destination=ledger.batch(scope.operationId,"destination");await ledger.commit(scope.operationId,"destination",{...chunk,batchId:destination.batchId,revision:destination.revision,requested:destination.requested,commits:mode==="mismatch"?chunk.commits.map(node=>({...node,tree:hash(9)})):chunk.commits});const finished=ledger.finish(scope.operationId);
  return{first:first.kind,replay:replay.kind,finished,bytes:ledger.serializedBytes(scope.operationId),receiptLength:this.ctx.storage.sql.exec<{n:number}>("SELECT MAX(length(payload)) AS n FROM history_chunks").one().n};
 }
}
export default{async fetch(request:Request,env:{TEST:DurableObjectNamespace<HistoryInspectionFixture>}){const mode=new URL(request.url).searchParams.get("mode")!;return Response.json(await env.TEST.getByName(mode).run(mode));}};
