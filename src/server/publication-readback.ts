import type {RepositoryReadCapability} from "./repository-read-budget";
import {isSafeRef} from "../core/sanitize";
export type PublicationReadbackReason="awaiting_readback"|"confirmed"|"not_observed"|"inspection_limit"|"scope_changed"|"capacity_unavailable"|"provider_unavailable";
export interface PublicationReadbackResult {reason:PublicationReadbackReason;head?:string;checkedAt:string}
export interface PublicationReadbackReport extends PublicationReadbackResult {journalId:string;automaticAttempts:number;canCheck:boolean}
/** A pinned canonical HEAD ancestry proof; absence never proves the push did not land. */
export async function inspectPublicationReadback(repo:Pick<RepositoryReadCapability,"log"|"readCommit">,branch:string,commit:string,tree:string,observedHead:string|null):Promise<PublicationReadbackResult>{
 if(!isSafeRef(branch)||![commit,tree].every(hash=>/^[a-f0-9]{40}$/.test(hash)))throw new Error("Invalid publication proof scope");
 const checkedAt=new Date().toISOString();
 if(observedHead===null)return {reason:"not_observed",checkedAt};
 if(!/^[a-f0-9]{40}$/.test(observedHead))throw new Error("Invalid native canonical head");
 const head=observedHead;
 for(let offset=0;offset<1000;offset+=100){
  const page=await repo.log({ref:head,limit:100,offset});
  if(page.length>100||page.some(item=>!/^[a-f0-9]{40}$/.test(item.hash)))throw new Error("Invalid publication ancestry response");
  const found=page.find(item=>item.hash===commit);
  if(found){const exact=await repo.readCommit(commit);if(found.treeHash!==tree||!exact||exact.hash!==commit||exact.treeHash!==tree)throw new Error("Publication tree proof differs from journal");return {reason:"confirmed",head,checkedAt};}
  if(page.length<100)return {reason:"not_observed",head,checkedAt};
 }
 return {reason:"inspection_limit",head,checkedAt};
}
export class PublicationReadbacks {
 constructor(private readonly storage:DurableObjectStorage){storage.sql.exec("CREATE TABLE IF NOT EXISTS publication_readbacks(journal_id TEXT PRIMARY KEY,scope TEXT NOT NULL,attempts INTEGER NOT NULL,doc TEXT NOT NULL)");storage.sql.exec("CREATE TABLE IF NOT EXISTS publication_readback_requests(request_id TEXT PRIMARY KEY,journal_id TEXT NOT NULL,scope TEXT NOT NULL)");}
 report(journalId:string,scope?:string):PublicationReadbackReport|null{const row=this.storage.sql.exec<{doc:string;attempts:number;scope:string}>("SELECT doc,attempts,scope FROM publication_readbacks WHERE journal_id=?",journalId).toArray()[0];if(row&&scope!==undefined&&row.scope!==scope)throw new Error("Publication recovery scope changed");return row?{...JSON.parse(row.doc) as PublicationReadbackResult,journalId,automaticAttempts:row.attempts,canCheck:(JSON.parse(row.doc) as PublicationReadbackResult).reason!=="confirmed"}:null;}
 replay(journalId:string,requestId:string,scope:string):PublicationReadbackReport|null {const prior=this.storage.sql.exec<{journal_id:string;scope:string}>("SELECT journal_id,scope FROM publication_readback_requests WHERE request_id=?",requestId).toArray()[0];if(!prior)return null;if(prior.journal_id!==journalId||prior.scope!==scope)throw new Error("Publication recovery request changed");return this.report(journalId,scope);}
 claim(journalId:string,scope:string,mode:"automatic"|"manual",requestId?:string):boolean{
  if(!/^[A-Za-z0-9_-]{1,200}$/.test(journalId)||scope.length>16384||mode==="manual"&&!/^[a-f0-9-]{36}$/.test(requestId??""))throw new Error("Invalid publication recovery identity");
  return this.storage.transactionSync(()=>{
   const old=this.storage.sql.exec<{scope:string;attempts:number}>("SELECT scope,attempts FROM publication_readbacks WHERE journal_id=?",journalId).toArray()[0];if(old&&old.scope!==scope)throw new Error("Publication recovery scope changed");
   if(mode==="automatic"&&(old?.attempts??0)>=4)return false;
   if(mode==="manual"){
    const prior=this.storage.sql.exec<{journal_id:string;scope:string}>("SELECT journal_id,scope FROM publication_readback_requests WHERE request_id=?",requestId!).toArray()[0];if(prior){if(prior.journal_id!==journalId||prior.scope!==scope)throw new Error("Publication recovery request changed");return false;}
    if(this.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM publication_readback_requests").one().n>=1000)throw new Error("Publication recovery request limit reached");
    this.storage.sql.exec("INSERT INTO publication_readback_requests VALUES(?,?,?)",requestId!,journalId,scope);
   }
   const attempts=(old?.attempts??0)+(mode==="automatic"?1:0),doc=JSON.stringify({reason:"awaiting_readback",checkedAt:new Date().toISOString()});
   this.storage.sql.exec("INSERT INTO publication_readbacks VALUES(?,?,?,?) ON CONFLICT(journal_id) DO UPDATE SET attempts=excluded.attempts,doc=excluded.doc",journalId,scope,attempts,doc);return true;
  });
 }
 save(journalId:string,scope:string,result:PublicationReadbackResult):void{this.storage.transactionSync(()=>{const row=this.storage.sql.exec<{scope:string;doc:string}>("SELECT scope,doc FROM publication_readbacks WHERE journal_id=?",journalId).toArray()[0];if(!row||row.scope!==scope)throw new Error("Publication recovery scope changed");if((JSON.parse(row.doc) as PublicationReadbackResult).reason==="confirmed")return;this.storage.sql.exec("UPDATE publication_readbacks SET doc=? WHERE journal_id=?",JSON.stringify(result),journalId);});}
}
