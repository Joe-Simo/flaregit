import {z} from 'zod';
import {applyBulk} from '../core/issue-bulk';
import {addLink,removeLink,type IssueLink} from '../core/issue-relations';
import {createMilestone,deleteMilestone,milestoneProgress,type Milestone} from '../core/issue-milestones';
import {validateTemplate,validateSubmission,type IssueTemplate} from '../core/issue-templates';
import type {Issue} from '../core/issue-triage';

const id=z.number().int().positive().safe();
const field=z.discriminatedUnion('type',[
 z.object({id:z.string().regex(/^[A-Za-z][A-Za-z0-9 _-]{0,59}$/),type:z.literal('text'),required:z.boolean()}).strict(),
 z.object({id:z.string().regex(/^[A-Za-z][A-Za-z0-9 _-]{0,59}$/),type:z.literal('checkbox'),required:z.boolean()}).strict(),
 z.object({id:z.string().regex(/^[A-Za-z][A-Za-z0-9 _-]{0,59}$/),type:z.literal('dropdown'),required:z.boolean(),options:z.array(z.string().min(1).max(100)).min(1).max(30)}).strict(),
]);
export const issueFeatureAction=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('bulk-label'),numbers:z.array(id).min(1).max(100),label:z.string().min(1).max(50)}).strict(),
 z.object({kind:z.literal('bulk-assign'),numbers:z.array(id).min(1).max(100),assignee:z.string().min(1).max(256)}).strict(),
 z.object({kind:z.literal('milestone-create'),title:z.string().min(1).max(100),dueDate:z.string().optional()}).strict(),
 z.object({kind:z.literal('milestone-delete'),id,reassignTo:id.optional()}).strict(),
 z.object({kind:z.literal('milestone-assign'),number:id,milestone:id.nullable()}).strict(),
 z.object({kind:z.literal('label-remove'),number:id,label:z.string().max(50)}).strict(),
 z.object({kind:z.literal('assignee-remove'),number:id,assignee:z.string().max(256)}).strict(),
 z.object({kind:z.literal('relation-add'),relation:z.enum(['duplicate-of','sub-issue-of']),from:id,to:id}).strict(),
 z.object({kind:z.literal('relation-remove'),relation:z.enum(['duplicate-of','sub-issue-of']),from:id,to:id}).strict(),
 z.object({kind:z.literal('templates'),templates:z.array(z.object({name:z.string().min(1).max(100),fields:z.array(field).min(1).max(20)}).strict()).max(20)}).strict(),
]);
export const issueFeatureWrite=z.object({expectedRevision:z.number().int().nonnegative().safe(),action:issueFeatureAction}).strict();
export type IssueFeatureWrite=z.infer<typeof issueFeatureWrite>;
type Triage=Issue&{milestone?:number};
export interface IssueFeatures{revision:number;triage:Record<string,Triage>;milestones:readonly Milestone[];links:readonly IssueLink[];templates:readonly IssueTemplate[];nextMilestone:number}
const empty=():IssueFeatures=>({revision:0,triage:{},milestones:[],links:[],templates:[],nextMilestone:1});
export class IssueFeatureStore{
 constructor(private readonly storage:DurableObjectStorage){storage.sql.exec('CREATE TABLE IF NOT EXISTS issue_features(id INTEGER PRIMARY KEY CHECK(id=1),document TEXT NOT NULL)');}
 read():IssueFeatures{const row=this.storage.sql.exec<{document:string}>('SELECT document FROM issue_features WHERE id=1').toArray()[0];return row?JSON.parse(row.document) as IssueFeatures:empty();}
 private issues(state:IssueFeatures){return this.storage.sql.exec<{number:number;state:'open'|'closed'}>('SELECT number,state FROM issues ORDER BY number LIMIT 10001').toArray().map(row=>({...state.triage[row.number],number:row.number,state:row.state,labels:state.triage[row.number]?.labels??[],assignees:state.triage[row.number]?.assignees??[]}));}
 view(){const state=this.read(),issues=this.issues(state);return {...state,issuesComplete:issues.length<=10000,progress:issues.length>10000?[]:state.milestones.map(m=>({id:m.id,...milestoneProgress(m.id,issues)}))};}
 update(input:IssueFeatureWrite,members:readonly string[],owner:boolean){return this.storage.transactionSync(()=>{
 const state=this.read();if(input.expectedRevision!==state.revision)return {ok:false as const,status:409,error:'Issue planning changed; reload before applying this action'};
 const issues=this.issues(state);if(issues.length>10000)return {ok:false as const,status:413,error:'Issue planning capacity reached'};
 const byNumber=new Map(issues.map(i=>[i.number,i]));const a=input.action;
 const fail=(error:string)=>({ok:false as const,status:400,error});
 if((a.kind==='templates'||a.kind.startsWith('milestone-'))&&!owner)return {ok:false as const,status:403,error:'Only repository owners can manage milestones and templates'};
 switch(a.kind){
 case 'bulk-label':case 'bulk-assign':{
 const selected=a.numbers.map(n=>byNumber.get(n));if(selected.some(i=>!i))return fail('Unknown issue');
 const result=applyBulk(selected.filter((i):i is Triage=>i!==undefined),a.kind==='bulk-label'?{kind:'label',label:a.label}:{kind:'assign',assignee:a.assignee,members});
 if(!result.ok)return fail(result.errors.map(e=>`${e.number??''} ${e.error}`).join('; '));
 for(const issue of result.issues){if(issue.labels.length>50||issue.assignees.length>20)return fail('Issue triage capacity reached');state.triage[issue.number]={...byNumber.get(issue.number)!,...issue};}break;}
 case 'label-remove':case 'assignee-remove':case 'milestone-assign':{
 const issue=byNumber.get(a.number);if(!issue)return fail('Unknown issue');
 if(a.kind==='label-remove')state.triage[a.number]={...issue,labels:issue.labels.filter(v=>v!==a.label)};
 else if(a.kind==='assignee-remove')state.triage[a.number]={...issue,assignees:issue.assignees.filter(v=>v!==a.assignee)};
 else{if(a.milestone!==null&&!state.milestones.some(m=>m.id===a.milestone))return fail('Unknown milestone');const {milestone:_old,...rest}=issue;state.triage[a.number]=a.milestone===null?rest:{...rest,milestone:a.milestone};}break;}
 case 'milestone-create':{
 if(state.milestones.length>=100)return fail('Milestone capacity reached');const result=createMilestone(state.milestones,a.title,a.dueDate);if(!result.ok)return fail(result.error);
 state.milestones=[...state.milestones,{...result.value,id:state.nextMilestone++}];break;}
 case 'milestone-delete':{
 const result=deleteMilestone(state.milestones,issues,a.id,a.reassignTo);if(!result.ok)return fail(result.error);state.milestones=result.value.milestones;
 for(const changed of result.value.issues){const {milestone:_old,...original}=byNumber.get(changed.number)!;state.triage[changed.number]={...original,...changed};}break;}
 case 'relation-add':case 'relation-remove':{
 if(!byNumber.has(a.from)||!byNumber.has(a.to))return fail('Unknown issue');const link:IssueLink={kind:a.relation,from:a.from,to:a.to};
 if(a.kind==='relation-remove')state.links=removeLink(state.links,link);else{const result=addLink(state.links,link);if(!result.ok)return fail(result.error);state.links=result.links;}break;}
 case 'templates':{if(new Set(a.templates.map(t=>t.name)).size!==a.templates.length)return fail('Template names must be unique');for(const template of a.templates){const errors=validateTemplate(template);if(errors.length)return fail(errors.join('; '));}state.templates=a.templates;break;}
 }
 state.revision++;const document=JSON.stringify(state);if(new TextEncoder().encode(document).length>2_000_000)return {ok:false as const,status:413,error:'Issue planning capacity reached'};
 this.storage.sql.exec('INSERT INTO issue_features VALUES(1,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document',document);return {ok:true as const,value:this.view()};
 });}
 preview(name:string,values:Readonly<Record<string,unknown>>){const template=this.read().templates.find(t=>t.name===name);if(!template)return {ok:false as const,error:'Unknown template'};const result=validateSubmission(template,values);if(!result.ok)return result;const body=template.fields.filter(f=>result.values[f.id]!==undefined).map(f=>`## ${f.id}\n${String(result.values[f.id])}`).join('\n\n');return body.length>20000?{ok:false as const,error:'Template response exceeds issue description limit'}:{ok:true as const,body};}
}
