import {z} from 'zod';
import {progress} from '../core/project-planning';
import {startPlan,addPlanItem,updatePlanItem,createIteration,assignIteration,setAutomation,setStatusBulk,applyView,exportProject,type ProjectPlan,type ProjectView} from '../core/project-views';

const label=z.string().trim().min(1).max(80);
const fieldName=label.refine(value=>!['__proto__','prototype','constructor','issueNumber'].includes(value),'Reserved field name');
const value=z.union([z.string().max(1000),z.number().finite()]);
const version=z.number().int().nonnegative().safe();
const issue=z.number().int().positive().safe();
const fields=z.record(fieldName,value).refine(value=>Object.keys(value).length<=20);
const view=z.object({name:label,layout:z.enum(['board','table','timeline']),filter:z.object({status:z.array(label).min(1).max(20).optional(),iteration:label.optional()}).strict(),sortBy:label,direction:z.enum(['asc','desc'])}).strict();
const rule=z.object({when:z.object({toStatus:label}).strict(),then:z.object({setField:fieldName,value}).strict()}).strict();
export const planningMutationSchema=z.discriminatedUnion('operation',[
  z.object({operation:z.literal('configure'),expectedVersion:version,statuses:z.array(label).min(1).max(20).refine(values=>new Set(values).size===values.length),fieldTypes:z.record(fieldName,z.enum(['text','number'])).refine(value=>Object.keys(value).length<=20)}).strict(),
  z.object({operation:z.literal('addItem'),expectedVersion:version,issueNumber:issue}).strict(),
  z.object({operation:z.literal('updateItem'),expectedVersion:version,issueNumber:issue,expectedItemVersion:issue,status:label.optional(),fields:fields.optional()}).strict().refine(value=>value.status!==undefined||value.fields!==undefined),
  z.object({operation:z.literal('createIteration'),expectedVersion:version,iteration:z.object({id:label,title:label,start:z.string().max(10),end:z.string().max(10)}).strict()}).strict(),
  z.object({operation:z.literal('assignIteration'),expectedVersion:version,issueNumber:issue,iterationId:label}).strict(),
  z.object({operation:z.literal('setAutomation'),expectedVersion:version,rules:z.array(rule).max(50)}).strict(),
  z.object({operation:z.literal('saveView'),expectedVersion:version,view}).strict(),
  z.object({operation:z.literal('bulkStatus'),expectedVersion:version,issueNumbers:z.array(issue).min(1).max(100),status:label,expectedVersions:z.array(issue).min(1).max(100)}).strict(),
]);
export type PlanningMutation=z.infer<typeof planningMutationSchema>;
const iteration=z.object({id:label,title:label,start:z.string().max(10),end:z.string().max(10)}).strict();
export const planningStateSchema=z.object({version,plan:z.object({project:z.object({statuses:z.array(label).min(1).max(20).refine(values=>new Set(values).size===values.length),fieldTypes:z.record(fieldName,z.enum(['text','number'])).refine(value=>Object.keys(value).length<=20),items:z.array(z.object({issueNumber:issue,status:label,fields,version:issue}).strict()).max(1000)}).strict(),iterations:z.array(iteration).max(100),assignments:z.array(z.object({issueNumber:issue,iterationId:label}).strict()).max(1000),rules:z.array(rule).max(50)}).strict(),views:z.array(view).max(50)}).strict();
/** Restored plans must remain internally consistent and refer to restored real issues. */
export function validatePlanningArchive(value:unknown,issueNumbers:readonly number[]):PlanningState{
  const state=planningStateSchema.parse(value),plan=state.plan;
  if(new TextEncoder().encode(JSON.stringify(state)).length>1_000_000)throw new PlanningError('Planning archive exceeds capacity');
  const seen=new Set<number>();
  for(const item of plan.project.items){
    if(!issueNumbers.includes(item.issueNumber)||seen.has(item.issueNumber)||!plan.project.statuses.includes(item.status))throw new PlanningError('Planning archive contains invalid issue references or statuses');
    seen.add(item.issueNumber);
    for(const [name,value]of Object.entries(item.fields))if((plan.project.fieldTypes[name]==='text'?'string':plan.project.fieldTypes[name])!==typeof value)throw new PlanningError('Planning archive field type mismatch');
  }
  let rebuilt=startPlan(plan.project);
  for(const iteration of plan.iterations){const result=createIteration(rebuilt,iteration);if(!result.ok)throw new PlanningError(result.error);rebuilt=result.value;}
  const assigned=new Set<number>();for(const assignment of plan.assignments){if(assigned.has(assignment.issueNumber))throw new PlanningError('Duplicate planning assignment');assigned.add(assignment.issueNumber);const result=assignIteration(rebuilt,assignment.issueNumber,assignment.iterationId);if(!result.ok)throw new PlanningError(result.error);rebuilt=result.value;}
  const automation=setAutomation(plan,plan.rules);if(!automation.ok)throw new PlanningError(automation.error);
  const names=new Set<string>();for(const view of state.views){if(names.has(view.name))throw new PlanningError('Duplicate planning view');names.add(view.name);const result=applyView(plan,view);if(!result.ok)throw new PlanningError(result.error);}
  return state;
}
export interface PlanningState{version:number;plan:ProjectPlan;views:ProjectView[]}
type IssueSummary={number:number;title:string;state:string};
export class PlanningError extends Error{constructor(message:string,readonly status:number=400){super(message);}}

/** One repository plan, using real issue references and atomic whole-plan versions. */
export class PlanningStore{
  constructor(private readonly storage:DurableObjectStorage){storage.sql.exec('CREATE TABLE IF NOT EXISTS repository_planning(id INTEGER PRIMARY KEY CHECK(id=1),doc TEXT NOT NULL)');}
  private state():PlanningState{const row=this.storage.sql.exec<{doc:string}>('SELECT doc FROM repository_planning WHERE id=1').toArray()[0];return row?JSON.parse(row.doc) as PlanningState:{version:0,plan:startPlan({statuses:['Todo','Doing','Done'],fieldTypes:{},items:[]}),views:[]};}
  private issues(){return this.storage.sql.exec<IssueSummary>('SELECT number,title,state FROM issues ORDER BY number DESC LIMIT 1001').toArray();}
  snapshot(){const state=this.state(),issues=this.issues(),linked=state.plan.project.items.flatMap(item=>this.storage.sql.exec<IssueSummary>('SELECT number,title,state FROM issues WHERE number=?',item.issueNumber).toArray());return {...state,issues:[...new Map([...issues.slice(0,1000),...linked].map(row=>[row.number,row])).values()],issuesTruncated:issues.length>1000,progress:progress(state.plan.project)};}
  export(){return exportProject(this.state().plan);}
  mutate(input:PlanningMutation,owner:boolean){return this.storage.transactionSync(()=>{
    const state=this.state();if(input.expectedVersion!==state.version)throw new PlanningError('The plan changed; refresh before saving',409);
    if((input.operation==='configure'||input.operation==='setAutomation')&&!owner)throw new PlanningError('Only the repository owner can configure fields, statuses or automation',403);
    let plan=state.plan,views=state.views;
    const accept=(result:{ok:true;value:ProjectPlan}|{ok:false;error:string})=>{if(!result.ok)throw new PlanningError(result.error,result.error.includes('changed since')?409:400);plan=result.value;};
    switch(input.operation){
      case 'configure':{
        for(const item of plan.project.items){if(!input.statuses.includes(item.status))throw new PlanningError('A status still used by an item cannot be removed');for(const [name,value]of Object.entries(item.fields)){if((input.fieldTypes[name]==='text'?'string':input.fieldTypes[name])!==typeof value)throw new PlanningError('Fields with saved values must retain their types');}}
        const candidate={...plan,project:{...plan.project,statuses:input.statuses,fieldTypes:input.fieldTypes}};
        const checked=setAutomation(candidate,candidate.rules);if(!checked.ok)throw new PlanningError(checked.error);
        for(const saved of views){const result=applyView(candidate,saved);if(!result.ok)throw new PlanningError(result.error);}
        plan=candidate;break;
      }
      case 'addItem':{
        if(plan.project.items.length>=1000)throw new PlanningError('Planning is limited to 1000 issue references',413);
        const exists=this.storage.sql.exec<{number:number}>('SELECT number FROM issues WHERE number=?',input.issueNumber).toArray();
        accept(addPlanItem(plan,input.issueNumber,exists.map(row=>row.number)));break;
      }
      case 'updateItem':accept(updatePlanItem(plan,input.issueNumber,input.expectedItemVersion,input));break;
      case 'createIteration':if(plan.iterations.length>=100)throw new PlanningError('Planning is limited to 100 iterations',413);accept(createIteration(plan,input.iteration));break;
      case 'assignIteration':accept(assignIteration(plan,input.issueNumber,input.iterationId));break;
      case 'setAutomation':accept(setAutomation(plan,input.rules));break;
      case 'saveView':{const checked=applyView(plan,input.view);if(!checked.ok)throw new PlanningError(checked.error);views=views.filter(saved=>saved.name!==input.view.name);if(views.length>=50)throw new PlanningError('Planning is limited to 50 saved views',413);views=[...views,input.view];break;}
      case 'bulkStatus':{const result=setStatusBulk(plan,input.issueNumbers,input.status,input.expectedVersions);if(!result.ok)throw new PlanningError(result.errors.map(value=>value.error).join('; '),result.errors.some(value=>value.error.includes('changed since'))?409:400);plan=result.value;break;}
    }
    const next:PlanningState={version:state.version+1,plan,views},doc=JSON.stringify(next);
    if(new TextEncoder().encode(doc).length>1_000_000)throw new PlanningError('Planning capacity reached; saved work remains preserved',413);
    this.storage.sql.exec('INSERT INTO repository_planning VALUES(1,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc',doc);
    return this.snapshot();
  });}
}
