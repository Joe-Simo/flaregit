import type {Project} from './project-planning';
/** Status names are owner-defined. Distribution measures stored items without
 * assigning completion meaning to the final column or an accepted-work status. */
export function planningDistribution(project:Pick<Project,'statuses'|'items'>){
 const counts=new Map(project.statuses.map(status=>[status,0]));
 for(const item of project.items)counts.set(item.status,(counts.get(item.status)??0)+1);
 const total=project.items.length;
 return{total,statuses:[...counts].map(([status,count])=>({status,count,percentage:total===0?0:count/total*100}))};
}
