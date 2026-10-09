import {activeIssueSql,ensureIssueLifecycleSchema,isIssueActive,IssueLifecycleStore} from './issue-lifecycle';
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
  z.object({operation:z.literal('setAcceptedStatus'),expectedVersion:version,acceptedIssueStatus:label.nullable()}).strict(),
  z.object({operation:z.literal('retryAccepted'),expectedVersion:version,journalId:z.string().min(1).max(200),issueNumber:issue,expectedItemVersion:issue}).strict(),
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
export const planningStateSchema=z.object({version,acceptedIssueStatus:label.optional(),plan:z.object({project:z.object({statuses:z.array(label).min(1).max(20).refine(values=>new Set(values).size===values.length),fieldTypes:z.record(fieldName,z.enum(['text','number'])).refine(value=>Object.keys(value).length<=20),items:z.array(z.object({issueNumber:issue,status:label,fields,version:issue}).strict()).max(1000)}).strict(),iterations:z.array(iteration).max(100),assignments:z.array(z.object({issueNumber:issue,iterationId:label}).strict()).max(1000),rules:z.array(rule).max(50)}).strict(),views:z.array(view).max(50)}).strict();
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
  if(state.acceptedIssueStatus&&!plan.project.statuses.includes(state.acceptedIssueStatus))throw new PlanningError('Accepted issue status must be a current planning status');
  let rebuilt=startPlan(plan.project);
  for(const iteration of plan.iterations){const result=createIteration(rebuilt,iteration);if(!result.ok)throw new PlanningError(result.error);rebuilt=result.value;}
  const assigned=new Set<number>();for(const assignment of plan.assignments){if(assigned.has(assignment.issueNumber))throw new PlanningError('Duplicate planning assignment');assigned.add(assignment.issueNumber);const result=assignIteration(rebuilt,assignment.issueNumber,assignment.iterationId);if(!result.ok)throw new PlanningError(result.error);rebuilt=result.value;}
  const automation=setAutomation(plan,plan.rules);if(!automation.ok)throw new PlanningError(automation.error);
  const names=new Set<string>();for(const view of state.views){if(names.has(view.name))throw new PlanningError('Duplicate planning view');names.add(view.name);const result=applyView(plan,view);if(!result.ok)throw new PlanningError(result.error);}
  return state;
}
export interface PlanningState{version:number;acceptedIssueStatus?:string;plan:ProjectPlan;views:ProjectView[]}
export interface AcceptedPlanningReceipt{journalId:string;issueNumber:number;commit:string;acceptedIssueStatus:string|null;rules:ProjectPlan['rules'];phase:'applied'|'blocked'|'ignored';reason?:string;itemVersion:number|null}
type IssueSummary={number:number;title:string;state:string};
export class PlanningError extends Error{constructor(message:string,readonly status:number=400){super(message);}}

/** One repository plan, using real issue references and atomic whole-plan versions. */
export class PlanningStore{
  constructor(private readonly storage:DurableObjectStorage){ensureIssueLifecycleSchema(storage);storage.sql.exec('CREATE TABLE IF NOT EXISTS repository_planning(id INTEGER PRIMARY KEY CHECK(id=1),doc TEXT NOT NULL)');storage.sql.exec('CREATE TABLE IF NOT EXISTS accepted_planning_receipts(journal_id TEXT NOT NULL,issue_number INTEGER NOT NULL,doc TEXT NOT NULL,PRIMARY KEY(journal_id,issue_number))');}
  private state():PlanningState{const row=this.storage.sql.exec<{doc:string}>('SELECT doc FROM repository_planning WHERE id=1').toArray()[0];return row?JSON.parse(row.doc) as PlanningState:{version:0,plan:startPlan({statuses:['Todo','Doing','Done'],fieldTypes:{},items:[]}),views:[]};}
  private issues(){return this.storage.sql.exec<IssueSummary>(`SELECT i.number,i.title,i.state FROM issues i WHERE ${activeIssueSql('i')} ORDER BY i.number DESC LIMIT 1001`).toArray();}
  private activePlan(plan:ProjectPlan):ProjectPlan{const items=plan.project.items.filter(item=>isIssueActive(this.storage,item.issueNumber)),numbers=new Set(items.map(item=>item.issueNumber));return {...plan,project:{...plan.project,items},assignments:plan.assignments.filter(assignment=>numbers.has(assignment.issueNumber))};}
  snapshot(){const state=this.state(),plan=this.activePlan(state.plan),issues=this.issues(),linked=plan.project.items.flatMap(item=>this.storage.sql.exec<IssueSummary>(`SELECT i.number,i.title,i.state FROM issues i WHERE number=? AND ${activeIssueSql('i')}`,item.issueNumber).toArray()),active=new Set(plan.project.items.map(item=>item.issueNumber));return {...state,plan,inactiveReferences:state.plan.project.items.filter(item=>!active.has(item.issueNumber)).map(item=>({issueNumber:item.issueNumber,available:false as const})),issues:[...new Map([...issues.slice(0,1000),...linked].map(row=>[row.number,row])).values()],issuesTruncated:issues.length>1000,progress:progress(plan.project),acceptedFollowups:this.receipts().map(receipt=>isIssueActive(this.storage,receipt.issueNumber)?receipt:{journalId:receipt.journalId,issueNumber:receipt.issueNumber,commit:receipt.commit,acceptedIssueStatus:null,rules:[],phase:'ignored' as const,reason:'Linked issue is inactive; this follow-up is historical',itemVersion:null})};}
  export(){return exportProject(this.activePlan(this.state().plan));}
  private receipts(){return this.storage.sql.exec<{doc:string}>('SELECT doc FROM accepted_planning_receipts ORDER BY rowid DESC LIMIT 50').toArray().map(row=>JSON.parse(row.doc) as AcceptedPlanningReceipt);}
  private receipt(journalId:string,issueNumber:number){const row=this.storage.sql.exec<{doc:string}>('SELECT doc FROM accepted_planning_receipts WHERE journal_id=? AND issue_number=?',journalId,issueNumber).toArray()[0];return row?JSON.parse(row.doc) as AcceptedPlanningReceipt:undefined;}
  private saveReceipt(receipt:AcceptedPlanningReceipt){this.storage.sql.exec('INSERT INTO accepted_planning_receipts VALUES(?,?,?) ON CONFLICT(journal_id,issue_number) DO UPDATE SET doc=excluded.doc',receipt.journalId,receipt.issueNumber,JSON.stringify(receipt));}
  /** Trusted primary acceptance calls once; repeat identities never acquire a later owner policy. */
  recordAccepted(journalId:string,issueNumber:number,commit:string){return this.storage.transactionSync(()=>{
    if(!journalId||journalId.length>200||!Number.isSafeInteger(issueNumber)||issueNumber<1||! /^[a-f0-9]{40}$/.test(commit))throw new PlanningError('Exact accepted planning identity required');
    const old=this.receipt(journalId,issueNumber);if(old){if(old.commit!==commit)throw new PlanningError('Accepted planning identity cannot change',409);return old;}
    const state=this.state(),item=state.plan.project.items.find(item=>item.issueNumber===issueNumber);
    if(new IssueLifecycleStore(this.storage).availability(issueNumber).status==='deleted'){const ignored:AcceptedPlanningReceipt={journalId,issueNumber,commit,acceptedIssueStatus:null,rules:[],itemVersion:null,phase:'ignored',reason:'Linked issue is inactive'};this.saveReceipt(ignored);return ignored;}
    const receipt:AcceptedPlanningReceipt={journalId,issueNumber,commit,acceptedIssueStatus:state.acceptedIssueStatus??null,rules:structuredClone(state.plan.rules),itemVersion:item?.version??null,phase:state.acceptedIssueStatus?'blocked':'ignored'};
    this.saveReceipt(receipt);if(receipt.acceptedIssueStatus)this.applyAccepted(receipt,item?.version);return this.receipt(journalId,issueNumber)!;
  });}
  private applyAccepted(receipt:AcceptedPlanningReceipt,expectedItemVersion:number|undefined){
    try{this.storage.transactionSync(()=>{
      const state=this.state();if(!receipt.acceptedIssueStatus||expectedItemVersion===undefined)throw new PlanningError('Link this issue to planning before retrying');
      const exists=isIssueActive(this.storage,receipt.issueNumber);if(!exists)throw new PlanningError('Linked issue is unavailable');
      const frozen=setAutomation(state.plan,receipt.rules);if(!frozen.ok)throw new PlanningError(frozen.error);
      const result=updatePlanItem(frozen.value,receipt.issueNumber,expectedItemVersion,{status:receipt.acceptedIssueStatus});if(!result.ok)throw new PlanningError(result.error);
      const plan={...result.value,rules:state.plan.rules},next={...state,version:state.version+1,plan},doc=JSON.stringify(next);if(new TextEncoder().encode(doc).length>1_000_000)throw new PlanningError('Planning capacity reached');
      this.storage.sql.exec('INSERT INTO repository_planning VALUES(1,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc',doc);this.saveReceipt({...receipt,phase:'applied',reason:undefined});
    });}catch(error){this.saveReceipt({...receipt,phase:'blocked',reason:error instanceof PlanningError?error.message:'Planning update unavailable'});}
  }
  private retryAccepted(journalId:string,issueNumber:number,expectedItemVersion:number){if(new IssueLifecycleStore(this.storage).availability(issueNumber).status==='deleted')throw new PlanningError('Linked issue is inactive',410);const receipt=this.receipt(journalId,issueNumber);if(!receipt)throw new PlanningError('Original accepted planning receipt unavailable',404);if(receipt.phase!=='blocked')return;const item=this.state().plan.project.items.find(item=>item.issueNumber===issueNumber);if(!item||item.version!==expectedItemVersion)throw new PlanningError('The item changed; refresh before retrying',409);this.applyAccepted(receipt,expectedItemVersion);}
  mutate(input:PlanningMutation,owner:boolean){return this.storage.transactionSync(()=>{
    const state=this.state();if(input.expectedVersion!==state.version)throw new PlanningError('The plan changed; refresh before saving',409);
    if((['configure','setAutomation','setAcceptedStatus','retryAccepted'].includes(input.operation))&&!owner)throw new PlanningError('Only the repository owner can configure fields, statuses or automation',403);
    if(input.operation==='retryAccepted'){this.retryAccepted(input.journalId,input.issueNumber,input.expectedItemVersion);return this.snapshot();}
    const inactive=state.plan.project.items.filter(item=>!isIssueActive(this.storage,item.issueNumber)),inactiveNumbers=new Set(inactive.map(item=>item.issueNumber));
    if(('issueNumber'in input&&new IssueLifecycleStore(this.storage).availability(input.issueNumber).status==='deleted')||(input.operation==='bulkStatus'&&input.issueNumbers.some(number=>new IssueLifecycleStore(this.storage).availability(number).status==='deleted')))throw new PlanningError('An inactive issue cannot be changed through planning',410);
    let plan=this.activePlan(state.plan),views=state.views,acceptedIssueStatus=state.acceptedIssueStatus;
    const accept=(result:{ok:true;value:ProjectPlan}|{ok:false;error:string})=>{if(!result.ok)throw new PlanningError(result.error,result.error.includes('changed since')?409:400);plan=result.value;};
    switch(input.operation){
      case 'setAcceptedStatus':if(input.acceptedIssueStatus!==null&&!plan.project.statuses.includes(input.acceptedIssueStatus))throw new PlanningError('Choose a current planning status');acceptedIssueStatus=input.acceptedIssueStatus??undefined;break;
      case 'configure':{
        if(acceptedIssueStatus&&!input.statuses.includes(acceptedIssueStatus))throw new PlanningError('Disable or change accepted issue status before removing it');
        for(const item of plan.project.items){if(!input.statuses.includes(item.status))throw new PlanningError('A status still used by an item cannot be removed');for(const [name,value]of Object.entries(item.fields)){if((input.fieldTypes[name]==='text'?'string':input.fieldTypes[name])!==typeof value)throw new PlanningError('Fields with saved values must retain their types');}}
        const candidate={...plan,project:{...plan.project,statuses:input.statuses,fieldTypes:input.fieldTypes}};
        const checked=setAutomation(candidate,candidate.rules);if(!checked.ok)throw new PlanningError(checked.error);
        for(const saved of views){const result=applyView(candidate,saved);if(!result.ok)throw new PlanningError(result.error);}
        plan=candidate;break;
      }
      case 'addItem':{
        if(plan.project.items.length>=1000)throw new PlanningError('Planning is limited to 1000 issue references',413);
        const exists=this.storage.sql.exec<{number:number}>(`SELECT i.number FROM issues i WHERE number=? AND ${activeIssueSql('i')}`,input.issueNumber).toArray();
        accept(addPlanItem(plan,input.issueNumber,exists.map(row=>row.number)));break;
      }
      case 'updateItem':accept(updatePlanItem(plan,input.issueNumber,input.expectedItemVersion,input));break;
      case 'createIteration':if(plan.iterations.length>=100)throw new PlanningError('Planning is limited to 100 iterations',413);accept(createIteration(plan,input.iteration));break;
      case 'assignIteration':accept(assignIteration(plan,input.issueNumber,input.iterationId));break;
      case 'setAutomation':accept(setAutomation(plan,input.rules));break;
      case 'saveView':{const checked=applyView(plan,input.view);if(!checked.ok)throw new PlanningError(checked.error);views=views.filter(saved=>saved.name!==input.view.name);if(views.length>=50)throw new PlanningError('Planning is limited to 50 saved views',413);views=[...views,input.view];break;}
      case 'bulkStatus':{const result=setStatusBulk(plan,input.issueNumbers,input.status,input.expectedVersions);if(!result.ok)throw new PlanningError(result.errors.map(value=>value.error).join('; '),result.errors.some(value=>value.error.includes('changed since'))?409:400);plan=result.value;break;}
    }
    const persisted={...plan,project:{...plan.project,items:[...plan.project.items,...inactive]},assignments:[...plan.assignments,...state.plan.assignments.filter(assignment=>inactiveNumbers.has(assignment.issueNumber))]};
    const next:PlanningState={version:state.version+1,plan:persisted,views,...(acceptedIssueStatus?{acceptedIssueStatus}:{})},doc=JSON.stringify(next);
    if(new TextEncoder().encode(doc).length>1_000_000)throw new PlanningError('Planning capacity reached; saved work remains preserved',413);
    this.storage.sql.exec('INSERT INTO repository_planning VALUES(1,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc',doc);
    return this.snapshot();
  });}
}
