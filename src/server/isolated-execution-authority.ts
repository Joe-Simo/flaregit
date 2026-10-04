import {WorkerEntrypoint} from "cloudflare:workers";
import {z} from "zod";
import type {Env} from "./env";
import {projectOf} from "./projects";
import {isolatedExecutionContextSchema} from "./isolated-execution-grants";

const requestSchema=z.object({scope:isolatedExecutionContextSchema.shape.scope,sourceDigest:z.string().regex(/^[a-f0-9]{64}$/),image:isolatedExecutionContextSchema.shape.image}).strict();
async function bounded<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{signal.throwIfAborted();let abort=()=>{};try{return await Promise.race([operation,new Promise<never>((_,reject)=>{abort=()=>reject(Error("Authority deadline"));signal.addEventListener("abort",abort,{once:true});})]);}finally{signal.removeEventListener("abort",abort);}}
export async function executionAuthorityResponse(request:Request,authorize:(context:z.infer<typeof requestSchema>)=>Promise<boolean>):Promise<Response>{
 const reply=(status:number,contextDigest?:string)=>Response.json(contextDigest?{allowed:true,contextDigest}:{allowed:false},{status,headers:{"Cache-Control":"no-store"}});
 if(request.method!=="POST"||request.url!=="https://execution-authority.invalid/allow")return reply(403);
 const reader=request.body?.getReader();if(!reader)return reply(400);
 const signal=AbortSignal.timeout(10000);const chunks:Uint8Array[]=[];let size=0;
 try{
  for(;;){const next=await bounded(reader.read(),signal);signal.throwIfAborted();if(next.done)break;size+=next.value.byteLength;if(size>2048)throw Error("Authority input bound");chunks.push(next.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes),context=requestSchema.parse(JSON.parse(text));
  if(!await bounded(authorize(context),signal))return reply(403);signal.throwIfAborted();
  const contextDigest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),byte=>byte.toString(16).padStart(2,"0")).join("");
  if(!await bounded(authorize(context),signal))return reply(403);signal.throwIfAborted();
  return reply(200,contextDigest);
 }catch{void reader.cancel().catch(()=>{});return reply(403);}
}
/** Private service entrypoint, intentionally not exported/configured in the app.
 * Repository authority reads exact current candidate state and the Global budget.
 * A sandbox cannot supply an approval or reservation through this request. */
export class IsolatedExecutionAuthority extends WorkerEntrypoint<Env>{
 override fetch(request:Request){return executionAuthorityResponse(request,context=>projectOf(this.env,context.scope.projectId).authorizeIsolatedExecution(context));}
}
