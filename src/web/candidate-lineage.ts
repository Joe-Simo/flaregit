import type {CandidateGeneration} from '@/core/types';
/** Presentation derives only an unambiguous recorded successor; it never rewrites old attempts. */
export function preservedCandidateSuccessors(candidates:Record<string,CandidateGeneration>):Map<string,CandidateGeneration>{
 const result=new Map<string,CandidateGeneration>(),ambiguous=new Set<string>();
 for(const next of Object.values(candidates)){
  const previous=next.predecessorCandidateId?candidates[next.predecessorCandidateId]:undefined;
  if(!previous||previous.id===next.id||previous.status==='accepted'||next.preservationProtocolVersion!==1||!previous.workflowInstanceId||!/^[a-zA-Z0-9_-]{1,128}$/.test(previous.workflowInstanceId)||!next.workflowInstanceId||!/^[a-zA-Z0-9_-]{1,128}$/.test(next.workflowInstanceId)||next.workflowInstanceId===previous.workflowInstanceId||previous.participatingTaskIds.length<1||previous.participatingTaskIds.length>8||new Set(previous.participatingTaskIds).size!==previous.participatingTaskIds.length||new Set(next.participatingTaskIds).size!==next.participatingTaskIds.length||!next.legacyRerunId||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(next.legacyRerunId)||previous.participatingTaskIds.length!==next.participatingTaskIds.length||previous.participatingTaskIds.some(id=>!next.participatingTaskIds.includes(id)||!/^[a-f0-9]{40}$/.test(previous.participatingCommits[id]??'')||!/^[a-f0-9]{40}$/.test(next.participatingCommits[id]??'')||previous.participatingCommits[id]!==next.participatingCommits[id]))continue;
  if(result.has(previous.id)){ambiguous.add(previous.id);result.delete(previous.id);}else if(!ambiguous.has(previous.id))result.set(previous.id,next);
 }
 const cycles=new Set<string>();
 for(const id of result.keys()){
  const trail:string[]=[],seen=new Map<string,number>();let current:string|undefined=id;
  while(current!==undefined&&result.has(current)){const index=seen.get(current);if(index!==undefined){for(const member of trail.slice(index))cycles.add(member);break;}seen.set(current,trail.length);trail.push(current);current=result.get(current)?.id;}
 }
 for(const id of cycles)result.delete(id);
 return result;
}
