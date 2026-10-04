import {Database} from 'bun:sqlite';
import {expect,test} from 'bun:test';
import {MigrationIssuesLedger,type MigrationExternalIssue,type MigrationExternalComment} from '../src/server/migration-issues-ledger';
import {MigrationConversationPublication} from '../src/server/migration-conversation-publication';
function fixture(){const db=new Database(':memory:');const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){if(query.includes(';')){db.exec(query);return{toArray:()=>[],one:()=>({})};}const rows=db.query(query).all(...bindings);return{toArray:()=>rows,one:()=>rows[0]};}},transactionSync<T>(callback:()=>T){return db.transaction(callback)();}};db.exec('CREATE TABLE issues(number INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,body TEXT,state TEXT,author TEXT,created_at TEXT,updated_at TEXT,closed_by TEXT);CREATE TABLE comments(id INTEGER PRIMARY KEY AUTOINCREMENT,subject TEXT,author TEXT,body TEXT,path TEXT,line INTEGER,"commit" TEXT,created_at TEXT)');return{db,ledger:new MigrationIssuesLedger(storage as unknown as DurableObjectStorage),publication:new MigrationConversationPublication(storage as unknown as DurableObjectStorage)};}
const authority={authorize:async()=>{},assertCurrent:()=>{}},date='2026-10-04T10:00:00Z';
const issue=(kind:'issue'|'pull_request',id:string,number:number):MigrationExternalIssue=>({kind,providerId:id,nodeId:`I${id}`,number,sourceUrl:`https://github.com/owner/repo/${kind==='issue'?'issues':'pull'}/${number}`,actor:{providerId:'123',login:'source-human',displayName:null},title:`Source ${number}`,body:'Original source text',state:'open',createdAt:date,updatedAt:date,closedAt:null});
async function staged(ledger:MigrationIssuesLedger,operationId:string,body='Original source text'){
 const scope={operationId,projectId:'p123456789abc',incarnation:'12345678-1234-4234-8234-123456789abc',ownerId:'owner',provider:'github' as const,repositoryId:'1',repositoryNodeId:'R1',sourceUrl:'https://github.com/owner/repo'};
 await ledger.begin(scope,authority);const records=[{...issue('issue','10',1),body},issue('pull_request','20',2)];
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('Comment preserved'))),v=>v.toString(16).padStart(2,'0')).join('');
 const comments:MigrationExternalComment[]=records.map((record,index)=>({providerId:String(100+index),nodeId:`C${index}`,issueNumber:record.number,repositoryId:'1',repositoryNodeId:'R1',sourceUrl:`${record.sourceUrl}#issuecomment-${100+index}`,actor:record.actor,body:'Comment preserved',bodyHash:hash,createdAt:date,updatedAt:date,identity:'external-unclaimed',nativeUserId:null}));
 await ledger.capture(operationId,{pageId:'captured-page',expectedRevision:0,cursor:null,nextCursor:null,records,comments,missing:[],observedAt:date},authority);return ledger.manifest(operationId,authority);
}
test('exact owner manifest publishes create-only issues/comments, archives PRs, and replays a lost acknowledgement without another batch',async()=>{
 const {db,ledger,publication}=fixture();try{const manifest=await staged(ledger,'migration-one'),request={eventId:crypto.randomUUID(),manifestHash:manifest.hash,expectedRevision:manifest.revision};
 expect(()=>publication.publish(manifest,{...request,manifestHash:'f'.repeat(64)},()=>{})).toThrow('exact');expect(db.query('SELECT number FROM issues').all()).toEqual([]);
 expect(()=>publication.publish(manifest,request,()=>{throw Error('Withdrawn');})).toThrow('Withdrawn');
 const first=publication.publish(manifest,request,()=>{});expect(first).toMatchObject({phase:'comments',nativeIssues:1,archivedPullRequests:1,nativeComments:0});expect(publication.publish(manifest,request,()=>{})).toEqual(first);
 expect(db.query('SELECT id FROM comments').all()).toEqual([]);
 const complete=publication.publish(manifest,{...request,eventId:crypto.randomUUID()},()=>{});expect(complete).toMatchObject({phase:'complete',nativeIssues:1,nativeComments:1,archivedPullRequests:1,archivedPullRequestComments:1});
 expect(db.query('SELECT author,created_at,body FROM issues').get()).toEqual({author:'GitHub @source-human (external, unclaimed)',created_at:date,body:'Original source text'});expect(publication.issueOrigin(1)).toMatchObject({identity:'external-unclaimed',nativeUserId:null,sourceUrl:'https://github.com/owner/repo/issues/1'});expect(publication.commentOrigin(1)?.createdAt).toBe(date);
 expect(db.query('SELECT COUNT(*) AS n FROM issues').get()).toEqual({n:1});expect(db.query('SELECT COUNT(*) AS n FROM comments').get()).toEqual({n:1});expect(ledger.get('migration-one')?.published).toBe(false);
 }finally{db.close();}
});
test('later source divergence and local edits preserve native records and cannot complete a replacement publication',async()=>{
 const {db,ledger,publication}=fixture();try{const original=await staged(ledger,'migration-one');for(let n=0;n<2;n++)publication.publish(original,{eventId:crypto.randomUUID(),manifestHash:original.hash,expectedRevision:original.revision},()=>{});
 const changed=await staged(ledger,'migration-two','Changed upstream text');expect(()=>publication.publish(changed,{eventId:crypto.randomUUID(),manifestHash:changed.hash,expectedRevision:changed.revision},()=>{})).toThrow('diverged');expect(publication.get('migration-two')).toBeNull();
 db.exec("UPDATE issues SET body='Maintainer local edit' WHERE number=1");const replay=await staged(ledger,'migration-three');expect(()=>publication.publish(replay,{eventId:crypto.randomUUID(),manifestHash:replay.hash,expectedRevision:replay.revision},()=>{})).toThrow('local changes');expect(db.query('SELECT body FROM issues WHERE number=1').get()).toEqual({body:'Maintainer local edit'});expect(publication.get('migration-three')).toBeNull();
 }finally{db.close();}
});
