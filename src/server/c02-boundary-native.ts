import {z} from 'zod';
import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import {C02BoundaryRuntime} from './c02-boundary-runtime';
import {c02BoundaryPlanSchema,type C02BoundaryPlan} from './c02-boundary-programs';
import {c02BoundaryCallbackPropsSchema,type C02BoundaryCallbackProps} from './c02-boundary-supervisor';
export const c02BoundaryNativeNames={taskA:'fixed-c02-boundary-a-v1',taskB:'fixed-c02-boundary-b-v1',supervisor:'fixed-c02-boundary-supervisor-v1'} as const;
interface BoundarySupervisorNamespace {getByName(name:string):{recordNativeRefusal(props:C02BoundaryCallbackProps,url:string,method:string):Promise<boolean>}}
export interface C02BoundaryNativeEnvironment {
 BOUNDARY_NATIVE?:DurableObjectNamespace<C02BoundaryNative>;
 BOUNDARY_SUPERVISOR?:BoundarySupervisorNamespace;
 C02_BOUNDARY_ENABLED?:string;
 C02_BOUNDARY_IMAGE?:string;
}
interface Registration {plan:C02BoundaryPlan;role:'task-a'|'task-b'}
/** A/B are distinct actual native namespaces, never UID labels in one VM. */
export class C02BoundaryNative extends DurableObject<C02BoundaryNativeEnvironment>{
 private read():Registration|null{this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS c02_boundary_registration(id INTEGER PRIMARY KEY CHECK(id=1),doc TEXT NOT NULL)');const row=this.ctx.storage.sql.exec<{doc:string}>('SELECT doc FROM c02_boundary_registration WHERE id=1').toArray()[0];return row?JSON.parse(row.doc) as Registration:null;}
 private identity(role:'task-a'|'task-b'){const ns=this.env.BOUNDARY_NATIVE,name=role==='task-a'?c02BoundaryNativeNames.taskA:c02BoundaryNativeNames.taskB;if(!ns||ns.idFromName(name).toString()!==this.ctx.id.toString())throw Error('Original boundary namespace required');}
 private enabled(){if(this.env.C02_BOUNDARY_ENABLED!=='true')throw Error('Boundary execution disabled');}
 private runtime(){const registration=this.read();if(!registration||!this.env.C02_BOUNDARY_IMAGE)throw Error('Boundary not registered');this.identity(registration.role);const scope=registration.role==='task-a'?registration.plan.taskA:registration.plan.taskB;const exports=this.ctx.exports as Cloudflare.Exports & {C02BoundaryDeny:LoopbackServiceStub<C02BoundaryDeny>};return new C02BoundaryRuntime(this.ctx.storage,()=>this.ctx.container,exports.C02BoundaryDeny({props:{requestId:registration.plan.requestId,scope}}),this.ctx.id.toString(),registration.role,this.env.C02_BOUNDARY_IMAGE);}
 async prepare(input:C02BoundaryPlan,role:'task-a'|'task-b'){
  this.enabled();role=z.enum(['task-a','task-b']).parse(role);const plan=c02BoundaryPlanSchema.parse(input);this.identity(role);const scope=role==='task-a'?plan.taskA:plan.taskB;if(scope.instanceId!==this.ctx.id.toString())throw Error('Boundary instance differs');
  this.ctx.storage.transactionSync(()=>{const old=this.read(),row={plan,role};if(old&&JSON.stringify(old)!==JSON.stringify(row))throw Error('Boundary registration immutable');if(!old)this.ctx.storage.sql.exec('INSERT INTO c02_boundary_registration VALUES(1,?)',JSON.stringify(row));});await this.runtime().prepare(plan);
 }
 async startA(){this.enabled();return this.runtime().startA();}
 async runB(){this.enabled();return this.runtime().runB();}
 async inspectA(){this.enabled();return this.runtime().inspectA();}
 status(){return this.read()?this.runtime().status():null;}
 async stop(){return this.read()?this.runtime().stop():null;}
 override async alarm(){if(this.read())await this.runtime().alarm();}
 /** Internal callback fence: only the actual B attacker command may generate
  * supervisor refusal evidence. Request headers cannot impersonate this props. */
 callbackAuthorized(props:unknown){const parsed=c02BoundaryCallbackPropsSchema.safeParse(props),registration=this.read();if(!parsed.success||!registration||registration.role!=='task-b')return false;this.identity('task-b');const expected=registration.plan.taskB,state=this.runtime().status(),last=state?.commands.at(-1);return parsed.data.requestId===registration.plan.requestId&&parsed.data.scope.taskId===expected.taskId&&parsed.data.scope.instanceId===this.ctx.id.toString()&&state?.phase==='dispatched'&&last?.kind==='attacker'&&!last.settled&&Date.now()<registration.plan.deadlineAt;}
}
/** Refuses all general egress. Exact owned callbacks may only record refusals. */
export class C02BoundaryDeny extends WorkerEntrypoint<C02BoundaryNativeEnvironment,C02BoundaryCallbackProps>{
 override async fetch(request:Request){const props=c02BoundaryCallbackPropsSchema.parse(this.ctx.props),native=this.env.BOUNDARY_NATIVE,supervisor=this.env.BOUNDARY_SUPERVISOR;
  if(native&&supervisor&&native.idFromName(c02BoundaryNativeNames.taskB).toString()===props.scope.instanceId){const job=native.getByName(c02BoundaryNativeNames.taskB);if(await job.callbackAuthorized(props))await supervisor.getByName(c02BoundaryNativeNames.supervisor).recordNativeRefusal(props,request.url,request.method);}
  return new Response('Denied',{status:403,headers:{'Cache-Control':'no-store'}});
 }
}
