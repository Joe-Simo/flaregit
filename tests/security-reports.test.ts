import {Database} from 'bun:sqlite';
import {test,expect} from 'bun:test';
import {SecurityStore} from '../src/server/security-store';
import {normalizeSecurityReport,securityImportSchema,securityTriageSchema} from '../src/core/security-report';
function storage(db:Database){return {sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return {toArray:()=>rows};}},transactionSync<T>(fn:()=>T){return db.transaction(fn)();}} as unknown as DurableObjectStorage;}
const commit='a'.repeat(40),tree='b'.repeat(40);
function report(present=true){return {version:'2.1.0',runs:[{tool:{driver:{name:'Semgrep',version:'1.90.0',rules:[{id:'synthetic-insecure-call'}]}},invocations:[{executionSuccessful:true}],results:present?[{ruleId:'synthetic-insecure-call',level:'warning',message:{text:'Do not persist diagnostic text: SYNTHETIC_SECRET'},locations:[{physicalLocation:{artifactLocation:{uri:'src/example.ts',uriBaseId:'%SRCROOT%'},region:{startLine:7,snippet:{text:'SYNTHETIC_SECRET'}}}}]}]:[]}]};}
const input=(sarif:unknown,expectedVersion=0)=>securityImportSchema.parse({expectedVersion,commit,tree,analysisKey:'semgrep/full-repository',coverage:'Complete repository; synthetic benign test rule only',sarif});

test('complete SARIF scanner import persists triage and fixed-revision resolution without erasing history or diagnostic secrets',async()=>{
  const path=`/tmp/security-${crypto.randomUUID()}.sqlite`;let db=new Database(path);
  try{
    let store=new SecurityStore(storage(db));const opened=store.import(input(report()),'member');expect(opened.alerts).toHaveLength(1);expect(opened.runs[0]).toMatchObject({tool:'Semgrep',source:'member-upload',commit,tree});expect(JSON.stringify(opened)).not.toContain('SYNTHETIC_SECRET');const id=opened.alerts[0]!.id;
    const dismissed=store.triage(id,securityTriageSchema.parse({expectedVersion:1,state:'dismissed',reason:'Synthetic benign fixture'}),'maintainer');expect(dismissed.alerts[0]!.state).toBe('dismissed');
    expect(()=>store.import(input(report(false),1),'member')).toThrow('changed');expect(store.read()).toEqual(dismissed);
    const corrected=store.import({...input(report(false),2),commit:'c'.repeat(40),tree:'d'.repeat(40)},'member');expect(corrected.alerts[0]).toMatchObject({id,state:'resolved',firstCommit:commit,lastCommit:'c'.repeat(40)});expect(corrected.alerts[0]!.events.map(event=>event.state)).toEqual(['open','dismissed','resolved']);
    expect(()=>store.triage(id,{expectedVersion:3,state:'open',reason:'Wrong manual reopen'},'member')).toThrow('scanner run');
    const reopened=store.import({...input(report(),3),commit:'e'.repeat(40)},'member');expect(reopened.alerts[0]).toMatchObject({id,state:'open'});expect(reopened.alerts[0]!.events).toHaveLength(4);
    db.close();db=new Database(path);store=new SecurityStore(storage(db));expect(store.read()).toEqual(reopened);
  }finally{db.close();await Bun.file(path).delete();}
});

test('failed, incomplete, unsupported and unsafe-path SARIF cannot resolve findings',()=>{
  const failed=report(false);failed.runs[0]!.invocations[0]!.executionSuccessful=false;expect(()=>normalizeSecurityReport(failed)).toThrow('Failed');
  expect(()=>normalizeSecurityReport({version:'2.1.0',runs:[]})).toThrow('complete');
  expect(()=>normalizeSecurityReport({...report(false),version:'2.0.0'})).toThrow('complete');
  for(const uri of ['../secret','%2e%2e/secret','/etc/passwd','https://example.test/file','src\\secret','src/file?token=x']){const unsafe=report();unsafe.runs[0]!.results[0]!.locations[0]!.physicalLocation.artifactLocation.uri=uri;expect(()=>normalizeSecurityReport(unsafe)).toThrow('paths');}
});

test('analysis keys isolate scanner coverage and incompatible scanner identity cannot clear another tool',()=>{
  const db=new Database(':memory:');try{const store=new SecurityStore(storage(db));store.import(input(report()),'member');const untouched=store.import({...input(report(false),1),analysisKey:'semgrep/subset'},'member');expect(untouched.alerts[0]!.state).toBe('open');const other=report(false);other.runs[0]!.tool.driver.name='Gitleaks';expect(()=>store.import(input(other,2),'member')).toThrow('one scanner');expect(store.read()).toEqual(untouched);}finally{db.close();}
});
