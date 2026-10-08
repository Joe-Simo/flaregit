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
export const issueFilterSchema=z.object({state:z.enum(['open','closed','all']).default('open'),q:z.string().trim().max(200).default(''),label:z.string().trim().min(1).max(50).optional(),assignee:z.string().min(1).max(256).optional(),milestone:z.union([id,z.literal('none')]).optional(),sort:z.enum(['updated-desc','created-desc','number-desc','number-asc']).default('updated-desc')}).strict();
export type IssueFilterCriteria=z.infer<typeof issueFilterSchema>;
export const savedIssueFilterWrite=z.discriminatedUnion('action',[
 z.object({action:z.literal('save'),expectedScope:z.string().regex(/^[a-f0-9]{64}$/),id:z.uuid(),name:z.string().trim().min(1).max(80),expectedVersion:z.number().int().nonnegative().safe(),filter:issueFilterSchema}).strict(),
 z.object({action:z.literal('delete'),expectedScope:z.string().regex(/^[a-f0-9]{64}$/),id:z.uuid(),expectedVersion:z.number().int().positive().safe()}).strict(),
]);
export type SavedIssueFilterWrite=z.infer<typeof savedIssueFilterWrite>;
const savedFilterSchema=z.object({id:z.uuid(),name:z.string().trim().min(1).max(80),version:z.number().int().positive().safe(),filter:issueFilterSchema}).strict();
export type SavedIssueFilter=z.infer<typeof savedFilterSchema>;
export class IssueFilterError extends Error{constructor(message:string,readonly status:400|404|409|410|413){super(message);}}
type IssueFilterRow={number:number;title:string;author:string;state:'open'|'closed';created_at:string;updated_at:string;closed_by:string|null;comments:number;text_match:number};
export class IssueFeatureStore{
 constructor(private readonly storage:DurableObjectStorage){storage.sql.exec('CREATE TABLE IF NOT EXISTS issue_features(id INTEGER PRIMARY KEY CHECK(id=1),document TEXT NOT NULL)');storage.sql.exec('CREATE TABLE IF NOT EXISTS issue_saved_filters(scope TEXT NOT NULL,actor_id TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,document TEXT NOT NULL,removed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,actor_id,id))');}
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
 savedFilters(scope:string,actorId:string){return this.storage.sql.exec<{document:string}>(`SELECT document FROM issue_saved_filters WHERE scope=? AND actor_id=? AND removed=0 ORDER BY json_extract(document,'$.name'),id LIMIT 50`,scope,actorId).toArray().map(row=>savedFilterSchema.parse(JSON.parse(row.document)));}
 savedFilterUpdate(scope:string,actorId:string,input:SavedIssueFilterWrite,authorize:()=>void){const parsed=savedIssueFilterWrite.parse(input);return this.storage.transactionSync(()=>{
  authorize();const row=this.storage.sql.exec<{version:number;document:string;removed:number}>('SELECT version,document,removed FROM issue_saved_filters WHERE scope=? AND actor_id=? AND id=?',scope,actorId,parsed.id).toArray()[0];
  if(parsed.action==='delete'){
   if(!row)throw new IssueFilterError('Saved issue filter unavailable',410);
   if(row.removed&&row.version===parsed.expectedVersion+1)return {deleted:true as const,id:parsed.id};
   if(row.removed||row.version!==parsed.expectedVersion)throw new IssueFilterError('Saved issue filter changed; reload before deleting',409);
   this.storage.sql.exec('UPDATE issue_saved_filters SET removed=1,version=version+1 WHERE scope=? AND actor_id=? AND id=?',scope,actorId,parsed.id);return {deleted:true as const,id:parsed.id};
  }
  const current=row?savedFilterSchema.parse(JSON.parse(row.document)):null;
  if(row?.removed)throw new IssueFilterError('Deleted filters cannot be recreated by replay',410);
  if(row&&row.version===parsed.expectedVersion+1&&current?.name===parsed.name&&JSON.stringify(current.filter)===JSON.stringify(parsed.filter))return current;
  if((row?.version??0)!==parsed.expectedVersion)throw new IssueFilterError('Saved issue filter changed; reload before saving',409);
  if(!row&&this.storage.sql.exec<{count:number}>('SELECT COUNT(*) AS count FROM issue_saved_filters WHERE scope=? AND actor_id=?',scope,actorId).toArray()[0]!.count>=200)throw new IssueFilterError('Personal saved-filter history capacity reached',413);
  if(!row&&this.savedFilters(scope,actorId).length>=50)throw new IssueFilterError('Save at most 50 issue filters per repository',413);
  if(this.savedFilters(scope,actorId).some(filter=>filter.id!==parsed.id&&filter.name.toLowerCase()===parsed.name.toLowerCase()))throw new IssueFilterError('A personal view with this name already exists; select it before updating',409);
  const saved:SavedIssueFilter={id:parsed.id,name:parsed.name,filter:parsed.filter,version:(row?.version??0)+1};
  this.storage.sql.exec('INSERT INTO issue_saved_filters VALUES(?,?,?,?,?,0) ON CONFLICT(scope,actor_id,id) DO UPDATE SET version=excluded.version,document=excluded.document',scope,actorId,parsed.id,saved.version,JSON.stringify(saved));return saved;
 });}
 filterSnapshot(input:IssueFilterCriteria){const filter=issueFilterSchema.parse(input),features=this.read(),rows=this.storage.sql.exec<IssueFilterRow>(`SELECT i.number,i.title,i.author,i.state,i.created_at,i.updated_at,i.closed_by,(SELECT COUNT(*) FROM comments c WHERE c.subject='issue:'||i.number) AS comments,(?='' OR instr(lower(i.title||' '||i.body),lower(?))>0) AS text_match FROM issues i ORDER BY i.number LIMIT 10001`,filter.q,filter.q).toArray();
  if(rows.length>10000)throw new IssueFilterError('Issue filtering supports at most 10000 issues; no incomplete result was returned',413);
  const matching=rows.filter(row=>{const triage=features.triage[row.number];return (filter.state==='all'||row.state===filter.state)&&row.text_match!==0&&(!filter.label||triage?.labels.includes(filter.label))&&(!filter.assignee||triage?.assignees.includes(filter.assignee))&&(filter.milestone===undefined||filter.milestone==='none'?filter.milestone===undefined||triage?.milestone===undefined:triage?.milestone===filter.milestone);});
  matching.sort((a,b)=>filter.sort==='number-asc'?a.number-b.number:filter.sort==='number-desc'?b.number-a.number:(filter.sort==='created-desc'?b.created_at.localeCompare(a.created_at):b.updated_at.localeCompare(a.updated_at))||b.number-a.number);
  return {filter,matching:matching.map(({text_match:_match,...row})=>row),source:JSON.stringify([features.revision,rows]),facets:{labels:[...new Set(rows.flatMap(row=>features.triage[row.number]?.labels??[]))].sort(),assignees:[...new Set(rows.flatMap(row=>features.triage[row.number]?.assignees??[]))],milestones:features.milestones.map(({id,title})=>({id,title}))},inspectedIssues:rows.length};
 }
 async filteredIssues(scope:string,actorId:string,input:IssueFilterCriteria,cursor?:string){
  const snapshot=this.filterSnapshot(input),version=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([scope,actorId,snapshot.filter,snapshot.source])))),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(this.filterSnapshot(snapshot.filter).source!==snapshot.source)throw new IssueFilterError('Issues changed during inspection; reload the current view',409);
  let offset=0;
  if(cursor){try{if(cursor.length>256||!/^[A-Za-z0-9_-]+$/.test(cursor))throw Error();const parsed=z.object({version:z.string().regex(/^[a-f0-9]{64}$/),offset:z.number().int().nonnegative().safe()}).strict().parse(JSON.parse(atob(cursor.replaceAll('-','+').replaceAll('_','/'))));if(parsed.version!==version||parsed.offset>snapshot.matching.length)throw Error();offset=parsed.offset;}catch{throw new IssueFilterError('Issue page no longer matches this principal, query or current issue version; reload the view',409);}}
  const issues=snapshot.matching.slice(offset,offset+50),next=offset+50<snapshot.matching.length?offset+50:null,nextCursor=next===null?null:btoa(JSON.stringify({version,offset:next})).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  return {sourceFingerprint:snapshot.source,issues,nextCursor,version,complete:next===null,total:snapshot.matching.length,offset,limit:50,inspectedIssues:snapshot.inspectedIssues,facets:snapshot.facets};
 }

 relationshipSnapshot(number:number){
  id.parse(number);const features=this.read(),rows=this.storage.sql.exec<{number:number;title:string;state:'open'|'closed';updated_at:string}>('SELECT number,title,state,updated_at FROM issues ORDER BY number LIMIT 10001').toArray();
  if(rows.length>10000)throw new IssueFilterError('Issue relationships support at most 10000 issues; no partial graph was returned',413);
  const byNumber=new Map(rows.map(row=>[row.number,row])),subject=byNumber.get(number);if(!subject)throw new IssueFilterError('Issue unavailable',404);
  const links=features.links.filter(link=>link.from===number||link.to===number);if(links.length>10000)throw new IssueFilterError('This issue exceeds the 10000-relationship inspection bound',413);
  const counts={parent:0,'sub-issue':0,'duplicate-target':0,duplicate:0};
  const items=links.map(link=>{const outgoing=link.from===number,kind=link.kind==='sub-issue-of'?outgoing?'parent' as const:'sub-issue' as const:outgoing?'duplicate-target' as const:'duplicate' as const,peer=outgoing?link.to:link.from,issue=byNumber.get(peer)??null;counts[kind]++;return {kind,link,number:peer,available:issue!==null,issue:issue?{number:issue.number,title:issue.title,state:issue.state}:null};});
  const rank={parent:0,'sub-issue':1,'duplicate-target':2,duplicate:3};items.sort((a,b)=>rank[a.kind]-rank[b.kind]||a.number-b.number);
  return {subject:{number:subject.number,title:subject.title,state:subject.state},featureRevision:features.revision,items,counts,source:JSON.stringify([features.revision,subject,items,links.map(link=>byNumber.get(link.from===number?link.to:link.from)??null)])};
 }
 async issueRelationships(scope:string,actorId:string,number:number,cursor?:string){
  const snapshot=this.relationshipSnapshot(number),version=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([scope,actorId,number,snapshot.source])))),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(this.relationshipSnapshot(number).source!==snapshot.source)throw new IssueFilterError('Issue relationships changed during inspection; reload the current issue',409);
  let offset=0;if(cursor){try{if(cursor.length>256||!/^[A-Za-z0-9_-]+$/.test(cursor))throw Error();const parsed=z.object({version:z.string().regex(/^[a-f0-9]{64}$/),offset:z.number().int().nonnegative().safe()}).strict().parse(JSON.parse(atob(cursor.replaceAll('-','+').replaceAll('_','/'))));if(parsed.version!==version||parsed.offset>snapshot.items.length)throw Error();offset=parsed.offset;}catch{throw new IssueFilterError('Relationship page no longer matches this principal, issue or current relationship version',409);}}
  const next=offset+50<snapshot.items.length?offset+50:null,nextCursor=next===null?null:btoa(JSON.stringify({version,offset:next})).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  return {sourceFingerprint:snapshot.source,issue:snapshot.subject,items:snapshot.items.slice(offset,offset+50),counts:snapshot.counts,featureRevision:snapshot.featureRevision,version,total:snapshot.items.length,offset,limit:50,nextCursor,complete:next===null};
 }

}
