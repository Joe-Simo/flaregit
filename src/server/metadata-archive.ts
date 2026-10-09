import {IssueLifecycleStore,ensureIssueLifecycleSchema,activeIssueSql,portableIssueTombstoneSchema} from './issue-lifecycle';
import {planningStateSchema,validatePlanningArchive} from "./planning-store";
import {z} from 'zod';

const text=z.string().max(2_000_000),integer=z.number().int().safe();
import {METADATA_ARCHIVE_TABLES as tables,archiveIdentitySchema as identity,archiveRowSchema as row,metadataArchiveSchema as archiveSchema,MAX_METADATA_ARCHIVE_BYTES} from '../core/metadata-archive';
export {MAX_METADATA_ARCHIVE_BYTES} from '../core/metadata-archive';
export type {ArchiveIdentity,MetadataArchive} from '../core/metadata-archive';
import type {ArchiveIdentity,MetadataArchive} from '../core/metadata-archive';
const discussionDocument=z.object({id:z.string().min(1),topicId:z.string().min(1),category:z.enum(['question','general','ideas','announcements']),title:z.string().max(200),body:z.string().max(8000),author:z.string().max(256),version:z.number().int().positive().safe(),createdAt:z.string().datetime(),updatedAt:z.string().datetime(),removed:z.boolean(),locked:z.boolean(),resolved:z.boolean(),moderationReason:z.string().max(500).optional(),pinned:z.boolean().optional(),answerId:z.string().regex(/^discussion_[a-f0-9-]{36}$/).optional(),convertedIssue:z.number().int().positive().safe().optional()}).strict();
function validateRow(table:string,value:z.infer<typeof row>){
 if(table==='issues')z.object({number:z.number().int().positive().safe(),title:z.string().min(1).max(200),body:text,state:z.enum(['open','closed']),author:z.string().min(1).max(256),created_at:text,updated_at:text,closed_by:text.nullable()}).strict().parse(value);
 if(table==='comments')z.object({id:z.number().int().positive().safe(),subject:z.string().min(1).max(200),author:z.string().min(1).max(256),body:text,path:text.nullable(),line:integer.nullable(),commit:text.nullable(),created_at:text}).strict().parse(value);
 if(table==='wiki_revisions')z.object({slug:z.string().regex(/^[a-z0-9-]{1,80}$/),id:z.number().int().positive().safe(),author:z.string().min(1).max(256),body:text,timestamp:text,parentRevision:z.number().int().positive().safe().nullable()}).strict().parse(value);
 if(table.endsWith('_discussion_entries')){const record=z.object({id:text,topic_id:text,author_id:z.string().min(1).max(256),doc:text}).strict().parse(value),doc=discussionDocument.parse(JSON.parse(record.doc));if(doc.id!==record.id||doc.topicId!==record.topic_id)throw new MetadataArchiveError('Discussion identity differs from its document',400);}
}

export class MetadataArchiveError extends Error{constructor(message:string,readonly status=409){super(message);}}
const omissions=['Portable issue deletions remain inactive on restore; live source permissions and mutation receipts are never imported','Issue attachment bytes and references require the separate per-issue attachment reference manifest; metadata restore does not restore those bytes','Git objects and refs require a separate native Git transfer','Agent execution state, candidates and accepted-review authority are not imported','Credentials, memberships, billing, provider receipts, webhooks and evidence blobs are excluded','Release records remain historical archive records; native tag provenance must be re-established before publication','Discussion records remain historical; imported source authors do not receive local user identities','Imported archive contributor identities are unverified claims, never local account attribution'];
async function digest(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
/** Fixed-table metadata transfer. Credentials and operational authority are never selected. */
export class MetadataArchives{
 constructor(private readonly storage:DurableObjectStorage){ensureIssueLifecycleSchema(storage);storage.sql.exec('CREATE TABLE IF NOT EXISTS metadata_archive_restores(request_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,doc TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata_archive_history(table_name TEXT NOT NULL,source_id TEXT NOT NULL,doc TEXT NOT NULL,PRIMARY KEY(table_name,source_id)); CREATE TABLE IF NOT EXISTS metadata_archive_origins(table_name TEXT NOT NULL,resource_id TEXT NOT NULL,doc TEXT NOT NULL,PRIMARY KEY(table_name,resource_id))');}
 private exists(table:string){return this.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?',table).toArray().length>0;}
 private columns(table:string){return this.storage.sql.exec<{name:string}>(`PRAGMA table_info("${table}")`).toArray().map(column=>column.name);}
 async export(source:ArchiveIdentity,includeIssueHistory=false):Promise<{archive:MetadataArchive;sha256:string}>{
  identity.parse(source);let lifecycleSnapshot='';
  const archive=this.storage.transactionSync(()=>{
   const lifecycle=new IssueLifecycleStore(this.storage),markers=this.storage.sql.exec<{issue_number:number;document:string}>('SELECT issue_number,document FROM issue_tombstones ORDER BY issue_number LIMIT 10001').toArray();
   if(markers.length>10000)throw new MetadataArchiveError('Issue deletion inventory exceeds archive capacity',413);lifecycleSnapshot=JSON.stringify(markers);
   const inactive=new Set(markers.map(marker=>marker.issue_number)),activeNumbers=this.exists('issues')?this.storage.sql.exec<{number:number}>(`SELECT i.number FROM issues i WHERE ${activeIssueSql('i')} ORDER BY i.number LIMIT 10001`).toArray().map(issue=>issue.number):[];
   const historical:Array<z.infer<typeof row>>=[];
   const exported:MetadataArchive['tables']=tables.filter(table=>table!=='issue_lifecycle_history'&&this.exists(table)).map(name=>({name,columns:this.columns(name),rows:this.storage.sql.exec(`SELECT * FROM "${name}" LIMIT 10001`).toArray().map(value=>{
    const parsed=row.parse(value);
    if(name==='issues'&&inactive.has(Number(parsed.number))&&!includeIssueHistory){parsed.title='Removed issue';parsed.body='';parsed.author='Historical contributor';parsed.closed_by=null;}
    if(name==='comments'&&/^issue:[1-9][0-9]*$/.test(String(parsed.subject))&&inactive.has(Number(String(parsed.subject).slice(6)))&&!includeIssueHistory){parsed.body='';parsed.author='Historical contributor';parsed.path=null;parsed.line=null;parsed.commit=null;}
    if(name==='repository_planning'&&typeof parsed.doc==='string'){
     const state=planningStateSchema.parse(JSON.parse(parsed.doc)),items=state.plan.project.items.filter(item=>activeNumbers.includes(item.issueNumber)),removed=state.plan.project.items.filter(item=>!activeNumbers.includes(item.issueNumber));
     if(removed.length)historical.push({table_name:name,source_id:'inactive-issue-references',doc:includeIssueHistory?parsed.doc:JSON.stringify({inactiveReferences:removed.map(item=>item.issueNumber),restricted:true})});
     const plan={...state.plan,project:{...state.plan.project,items},assignments:state.plan.assignments.filter(assignment=>items.some(item=>item.issueNumber===assignment.issueNumber))};parsed.doc=JSON.stringify({...state,plan});
    }
    if(name==='issue_features'&&typeof parsed.document==='string'){
     const document=JSON.parse(parsed.document) as {triage:Record<string,unknown>;links:Array<{from:number;to:number}>};
     if(Object.keys(document.triage).some(number=>!activeNumbers.includes(Number(number)))||document.links.some(link=>!activeNumbers.includes(link.from)||!activeNumbers.includes(link.to)))historical.push({table_name:name,source_id:'inactive-issue-references',doc:includeIssueHistory?parsed.document:JSON.stringify({restricted:true})});
     parsed.document=JSON.stringify({...document,triage:Object.fromEntries(Object.entries(document.triage).filter(([number])=>activeNumbers.includes(Number(number)))),links:document.links.filter(link=>activeNumbers.includes(link.from)&&activeNumbers.includes(link.to))});
    }
    if(name==='metadata_archive_origins'&&inactive.size&&!includeIssueHistory){
     const originTable=String(parsed.table_name),resource=Number(parsed.resource_id),comment=originTable==='comments'&&this.exists('comments')?this.storage.sql.exec<{subject:string}>('SELECT subject FROM comments WHERE id=?',resource).toArray()[0]:undefined;
     if(originTable==='issues'&&inactive.has(resource)||originTable==='comments'&&(!comment||/^issue:[1-9][0-9]*$/.test(comment.subject)&&inactive.has(Number(comment.subject.slice(6)))))parsed.doc=JSON.stringify({restricted:true,historicalOrigin:true});
    }
    if(inactive.size&&!includeIssueHistory&&(name==='migration_native_issue_origins'||name==='migration_native_comment_origins')&&parsed.kind==='issue'){
     const nativeId=parsed.native_id===null?null:Number(parsed.native_id),comment=nativeId!==null&&name==='migration_native_comment_origins'&&this.exists('comments')?this.storage.sql.exec<{subject:string}>('SELECT subject FROM comments WHERE id=?',nativeId).toArray()[0]:undefined;
     const issueNumber=name==='migration_native_issue_origins'?nativeId:comment&&/^issue:[1-9][0-9]*$/.test(comment.subject)?Number(comment.subject.slice(6)):null;
     if(issueNumber===null||!activeNumbers.includes(issueNumber))parsed.source_doc=JSON.stringify({restricted:true,historicalOrigin:true});
    }
    if(name==='metadata_archive_history'&&inactive.size&&!includeIssueHistory)parsed.doc=JSON.stringify({restricted:true,historicalRecord:parsed.source_id});
    if(name.endsWith('_discussion_entries')&&typeof parsed.doc==='string'){const doc=discussionDocument.parse(JSON.parse(parsed.doc));if(doc.removed)parsed.doc=JSON.stringify({...doc,title:'Removed',body:'',author:'Contributor'});}
    return parsed;
   })}));
   if(historical.length){const history=exported.find(table=>table.name==='metadata_archive_history');if(history)history.rows.push(...historical);else exported.push({name:'metadata_archive_history',columns:['table_name','source_id','doc'],rows:historical});}
   if(markers.length){const rawNumbers=new Set(exported.find(table=>table.name==='issues')?.rows.map(issue=>Number(issue.number))??[]);if(markers.some(marker=>!rawNumbers.has(marker.issue_number)))throw new MetadataArchiveError('A deletion marker lacks its preserved canonical issue audit row');exported.push({name:'issue_lifecycle_history',columns:['issue_number','document'],rows:markers.map(marker=>{const portable=portableIssueTombstoneSchema.parse(lifecycle.portable(marker.issue_number));return {issue_number:marker.issue_number,document:JSON.stringify(includeIssueHistory?portable:{...portable,sourceActorId:'historical-unknown',sourceIdentity:'historical-unknown'})};})});}
   const archive:MetadataArchive={version:2,source,createdAt:new Date().toISOString(),tables:exported,omissions:[...omissions,...(!includeIssueHistory&&inactive.size?['Removed issue/comment content, actor/identity provenance and inactive planning history are redacted for this exporter; deletion inventory is preserved']:[])]};
   if(archive.tables.some(table=>table.rows.length>10000)||new TextEncoder().encode(JSON.stringify(archive)).length>MAX_METADATA_ARCHIVE_BYTES)throw new MetadataArchiveError('Metadata archive exceeds bounded capacity; nothing was truncated',413);
   return archive;
  });
  const sha256=await digest(archive);if(JSON.stringify(this.storage.sql.exec('SELECT issue_number,document FROM issue_tombstones ORDER BY issue_number LIMIT 10001').toArray())!==lifecycleSnapshot)throw new MetadataArchiveError('Issue lifecycle changed during export; retry the current snapshot');
  return {archive,sha256};
 }
 async restore(value:unknown,target:ArchiveIdentity,requestId:string,expectedDigest:string,authorize:()=>void,prepareAuthority?:()=>Promise<()=>void>,importerActorId?:string){
  identity.parse(target);z.uuid().parse(requestId);
  if(new TextEncoder().encode(JSON.stringify(value)).length>MAX_METADATA_ARCHIVE_BYTES)throw new MetadataArchiveError('Metadata archive exceeds bounded capacity',413);
  const archive=archiveSchema.parse(value);
  if(await digest(archive)!==expectedDigest)throw new MetadataArchiveError('Metadata archive digest mismatch',400);
  if(archive.source.head!==target.head)throw new MetadataArchiveError('Destination accepted Git head differs from archive source');
  if(new Set(archive.tables.map(table=>table.name)).size!==archive.tables.length)throw new MetadataArchiveError('Duplicate archive table',400);
  const payloadHash=await digest({archive,target,requestId});
  const authority=await prepareAuthority?.();
  return this.storage.transactionSync(()=>{
   authority?.();authorize();
   const old=this.storage.sql.exec<{payload_hash:string;doc:string}>('SELECT payload_hash,doc FROM metadata_archive_restores WHERE request_id=?',requestId).toArray()[0];
   if(old){if(old.payload_hash!==payloadHash)throw new MetadataArchiveError('Restore request identity changed');return JSON.parse(old.doc) as {requestId:string;source:ArchiveIdentity;target:ArchiveIdentity;restoredRows:number;historicalRows:number;omissions:string[]};}
   if(this.storage.sql.exec('SELECT issue_number FROM issue_tombstones LIMIT 1').toArray().length)throw new MetadataArchiveError('Destination contains inactive issue identity history; it cannot be resurrected by an archive');
   if(this.storage.sql.exec('SELECT request_id FROM metadata_archive_restores LIMIT 1').toArray().length)throw new MetadataArchiveError('Destination has already received a metadata archive');
   for(const name of tables)if(this.exists(name)&&this.storage.sql.exec(`SELECT 1 FROM "${name}" LIMIT 1`).toArray().length)throw new MetadataArchiveError('Destination metadata must be empty');
   const issueNumbers=archive.tables.find(table=>table.name==='issues')?.rows.map(value=>Number(value.number))??[];
   const portableRows=archive.tables.find(table=>table.name==='issue_lifecycle_history');if(portableRows&&JSON.stringify(portableRows.columns)!==JSON.stringify(['issue_number','document']))throw new MetadataArchiveError('Invalid portable issue lifecycle columns',400);
   const portable=portableRows?.rows.map(value=>{if(typeof value.document!=='string')throw new MetadataArchiveError('Malformed portable issue history',400);const record=portableIssueTombstoneSchema.parse(JSON.parse(value.document));if(record.number!==value.issue_number||!issueNumbers.includes(record.number))throw new MetadataArchiveError('Portable deletion history must name an archived canonical issue',400);return record;})??[];if(new Set(portable.map(value=>value.number)).size!==portable.length)throw new MetadataArchiveError('Duplicate portable issue deletion',400);if(portable.length&&!importerActorId)throw new MetadataArchiveError('Verified restoring actor required for issue history');if(portable.length&&!z.uuid().safeParse(target.incarnation).success)throw new MetadataArchiveError('A current destination incarnation is required for portable issue history');
   for(const table of archive.tables)if(table.name==='repository_planning')for(const value of table.rows){if(typeof value.doc!=='string')throw new MetadataArchiveError('Malformed planning document',400);validatePlanningArchive(JSON.parse(value.doc),issueNumbers);}
   const wiki=archive.tables.find(table=>table.name==='wiki_revisions')?.rows??[];
   if(wiki.reduce((total,value)=>total+new TextEncoder().encode(String(value.body)).length,0)>5_000_000)throw new MetadataArchiveError('Wiki archive exceeds native capacity',413);
   const wikiHeads=new Map<string,number>();
   for(const value of [...wiki].sort((a,b)=>String(a.slug).localeCompare(String(b.slug))||Number(a.id)-Number(b.id))){const head=wikiHeads.get(String(value.slug))??0;if(value.id!==head+1||value.parentRevision!==(head||null)||[...String(value.body)].length>100000)throw new MetadataArchiveError('Invalid wiki revision chain or body',400);wikiHeads.set(String(value.slug),Number(value.id));}
   let restoredRows=0,historicalRows=0;
   for(const table of archive.tables){
    if(table.name==='issue_lifecycle_history')continue;
    if(!this.exists(table.name))throw new MetadataArchiveError(`Destination schema is missing ${table.name}`);
    const columns=this.columns(table.name);
    if(JSON.stringify(columns)!==JSON.stringify(table.columns))throw new MetadataArchiveError(`Destination schema differs for ${table.name}`);
    for(const value of table.rows){
     validateRow(table.name,value);
     if(Object.keys(value).length!==columns.length||columns.some(column=>!Object.hasOwn(value,column)))throw new MetadataArchiveError(`Malformed row in ${table.name}`,400);
     // These opaque JSON documents and native release receipts are kept as historical evidence,
     // rather than activating imported automation or transplanting source repository authority.
     if((table.name==='comments'&&(!/^issue:[1-9][0-9]*$/.test(String(value.subject))||!issueNumbers.includes(Number(String(value.subject).slice(6)))))||['issue_features','release_records','release_edits','repository_private_discussion_entries','repository_public_discussion_entries','migration_native_issue_origins','migration_native_comment_origins','metadata_archive_origins','metadata_archive_history'].includes(table.name)){
      this.storage.sql.exec('INSERT INTO metadata_archive_history VALUES(?,?,?)',table.name,String(historicalRows++),JSON.stringify(value));
     }else{
      const resourceId=table.name==='wiki_revisions'?`${value.slug}:${value.id}`:String(value.number??value.id);
      const origin={source:archive.source,archiveDigest:expectedDigest,sourceResourceId:resourceId,sourceAuthor:typeof value.author==='string'?value.author:null,identity:'external-unverified',nativeUserId:null};
      this.storage.sql.exec('INSERT INTO metadata_archive_origins VALUES(?,?,?)',table.name,resourceId,JSON.stringify(origin));
      if(Object.hasOwn(value,'author'))value.author='Imported archive contributor (unverified)';
      if(Object.hasOwn(value,'closed_by')&&value.closed_by!==null)value.closed_by='Imported archive contributor (unverified)';
      this.storage.sql.exec(`INSERT INTO "${table.name}" (${columns.map(column=>`"${column}"`).join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,...columns.map(column=>value[column]!));restoredRows++;
     }
    }
   }
   const lifecycle=new IssueLifecycleStore(this.storage);
   for(const record of portable){const issue=this.storage.sql.exec<{created_at:string;author:string}>('SELECT created_at,author FROM issues WHERE number=?',record.number).toArray()[0];if(!issue)throw new MetadataArchiveError('Imported issue audit row unavailable');lifecycle.importHistorical({projectId:target.projectId,incarnation:target.incarnation??'',number:record.number,createdAt:issue.created_at,author:issue.author},record,importerActorId!,requestId,()=>{authority?.();authorize();});historicalRows++;}
   const receipt={requestId,source:archive.source,target,restoredRows,historicalRows,omissions:[...new Set([...archive.omissions,...omissions,'Issue feature documents retained as historical records pending domain validation'])]};
   this.storage.sql.exec('INSERT INTO metadata_archive_restores VALUES(?,?,?)',requestId,payloadHash,JSON.stringify(receipt));return receipt;
  });
 }
 origin(table:string,resourceId:string){const value=this.storage.sql.exec<{doc:string}>('SELECT doc FROM metadata_archive_origins WHERE table_name=? AND resource_id=?',table,resourceId).toArray()[0];return value?JSON.parse(value.doc) as {source:ArchiveIdentity;archiveDigest:string;sourceResourceId:string;sourceAuthor:string|null;identity:'external-unverified';nativeUserId:null}:null;}
 history(includeIssueHistory=false){const rows=this.storage.sql.exec<{table_name:string;source_id:string;doc:string}>('SELECT table_name,source_id,doc FROM metadata_archive_history ORDER BY table_name,source_id LIMIT 10000').toArray();return !includeIssueHistory&&this.storage.sql.exec('SELECT issue_number FROM issue_tombstones LIMIT 1').toArray().length?rows.map(row=>({...row,doc:JSON.stringify({restricted:true})})):rows;}
}
