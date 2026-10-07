import {z} from 'zod';
const reportSchema=z.object({components:z.array(z.object({label:z.string().min(1),degradedNow:z.boolean(),lastCheckAt:z.number().finite().nullable()})).min(1)});
export interface HealthObservation {degraded:string[];unknown:boolean}
export function projectHealthObservation(report:unknown,now=Date.now()):HealthObservation {
 const parsed=reportSchema.safeParse(report);if(!parsed.success)return {degraded:[],unknown:true};
 const degraded:string[]=[];let unknown=false;
 for(const row of parsed.data.components){if(row.lastCheckAt===null||row.lastCheckAt>now||now-row.lastCheckAt>15*60_000){unknown=true;continue;}if(row.degradedNow)degraded.push(row.label);}
 return{degraded:[...new Set(degraded)],unknown};
}
export async function readHealthObservation(request:(input:string,init:RequestInit)=>Promise<Response>,signal:AbortSignal):Promise<HealthObservation>{
 try{const response=await request('/status.json',{signal:AbortSignal.any([signal,AbortSignal.timeout(10_000)]),cache:'no-store'});if(!response.ok)return{degraded:[],unknown:true};return projectHealthObservation(await response.json());}catch{return{degraded:[],unknown:true};}
}
