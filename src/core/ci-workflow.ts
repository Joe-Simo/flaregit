import {z} from 'zod';
import {parseWorkflow,WORKFLOW_TRIGGERS} from './workflow-parser';
const name=z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
const step=z.object({name,run:z.string().min(1).max(8000),timeoutMs:z.number().int().min(1).max(900_000).default(300_000)}).strict();
const job=z.object({name,needs:z.array(name).max(64).default([]),steps:z.array(step).min(1).max(20),matrix:z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/),z.array(z.string().max(200)).min(1).max(16)).default({}),secrets:z.array(name).max(20).default([]),cache:z.object({key:z.string().min(1).max(100),path:z.literal('.ci-cache')}).strict().optional()}).strict();
export const executableWorkflowSchema=z.object({name,triggers:z.array(z.enum(WORKFLOW_TRIGGERS)).min(1),jobs:z.array(job).min(1).max(64)}).strict();
export type ExecutableWorkflow=z.infer<typeof executableWorkflowSchema>;
export type ExecutableJob=ExecutableWorkflow['jobs'][number]&{id:string;environment:Readonly<Record<string,string>>;dependencies:readonly string[]};
/** A finite dialect: explicit shell steps, dependencies, environment matrices and one disposable cache directory. */
export function executableJobs(input:unknown):{workflow:ExecutableWorkflow;jobs:ExecutableJob[]}{
 const workflow=executableWorkflowSchema.parse(input),topology=parseWorkflow(workflow);if(!topology.ok)throw Error(topology.error);
 const expanded=new Map<string,ExecutableJob[]>();
 for(const spec of topology.workflow.jobs){const original=workflow.jobs.find(item=>item.name===spec.name)!;let environments:Array<Record<string,string>>=[{}];for(const [key,values]of Object.entries(original.matrix)){if(['PATH','HOME','TMPDIR','NODE_ENV','CI'].includes(key)||key.startsWith('FLAREGIT_'))throw Error('Matrix cannot replace runner control variables');if(environments.length*values.length>32)throw Error('Matrix exceeds 32 executions per job');environments=environments.flatMap(environment=>values.map(value=>({...environment,[key]:value})));}expanded.set(original.name,environments.map((environment,index)=>({...original,id:`${original.name}.${index}`,environment,dependencies:original.needs.flatMap(dependency=>expanded.get(dependency)!.map(item=>item.id))})));}
 const jobs=[...expanded.values()].flat();if(jobs.length>128)throw Error('Workflow exceeds 128 expanded jobs');return{workflow,jobs};
}
export async function workflowDigest(input:unknown){const workflow=executableWorkflowSchema.parse(input);const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(workflow)));return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
