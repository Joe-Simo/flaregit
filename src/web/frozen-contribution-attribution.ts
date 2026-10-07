import type {FrozenContributionAttribution} from '@/core/types';
/** Never infer historical authorship from the mutable task or its latest writer. */
export function frozenInputAttribution(snapshot:readonly FrozenContributionAttribution[]|undefined,taskId:string,commit:string|undefined){if(!commit)return null;const rows=snapshot?.filter(row=>row.taskId===taskId&&row.commit===commit)??[];return rows.length===1?rows[0]!:null;}
