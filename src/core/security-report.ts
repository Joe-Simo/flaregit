import {z} from 'zod';

const boundedText=z.string().trim().min(1).max(200).refine(value=>!/[\u0000-\u001f]/.test(value),'Control characters are not allowed');
export const securityCommitSchema=z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const securityTriageSchema=z.object({expectedVersion:z.number().int().nonnegative().safe(),state:z.enum(['open','dismissed']),reason:z.string().trim().min(1).max(1000)}).strict();
export const securityImportSchema=z.object({expectedVersion:z.number().int().nonnegative().safe(),commit:securityCommitSchema,tree:securityCommitSchema,analysisKey:boundedText,coverage:z.string().trim().min(1).max(1000),sarif:z.unknown()}).strict();
export type SecurityImport=z.infer<typeof securityImportSchema>;
export type SecurityTriage=z.infer<typeof securityTriageSchema>;
export type SecuritySeverity='error'|'warning'|'note'|'none';
export interface SecurityFinding{key:string;ruleId:string;path:string;line:number;level:SecuritySeverity;}
export interface NormalizedSecurityReport{tool:string;toolVersion:string|null;findings:SecurityFinding[];}
export interface SecurityEvent{at:string;actor:string;state:'open'|'dismissed'|'resolved';reason:string;commit:string;}
export interface SecurityAlert extends SecurityFinding{id:string;analysisKey:string;tool:string;state:'open'|'dismissed'|'resolved';firstCommit:string;lastCommit:string;events:SecurityEvent[];}
export interface SecurityRun{id:string;analysisKey:string;tool:string;toolVersion:string|null;commit:string;tree:string;source:'member-upload';coverage:string;at:string;actor:string;findingCount:number;}
export interface SecurityState{version:number;alerts:SecurityAlert[];runs:SecurityRun[];}
export class SecurityReportError extends Error{constructor(message:string,readonly status=400){super(message);}}

const locationSchema=z.object({physicalLocation:z.object({artifactLocation:z.object({uri:z.string().min(1).max(1000),uriBaseId:z.string().optional()}).passthrough(),region:z.object({startLine:z.number().int().positive().max(10_000_000)}).passthrough()}).passthrough()}).passthrough();
const resultSchema=z.object({ruleId:boundedText,level:z.enum(['error','warning','note','none']).optional(),locations:z.array(locationSchema).min(1).max(20),suppressions:z.array(z.unknown()).max(20).optional()}).passthrough();
const sarifSchema=z.object({version:z.literal('2.1.0'),runs:z.array(z.object({tool:z.object({driver:z.object({name:boundedText,version:boundedText.optional()}).passthrough()}).passthrough(),results:z.array(resultSchema).max(2000),invocations:z.array(z.object({executionSuccessful:z.boolean()}).passthrough()).min(1).max(20)}).passthrough()).length(1)}).passthrough();

/** Imports complete SARIF runs from maintained scanners; arbitrary diagnostic text/snippets never enter storage. */
export function normalizeSecurityReport(input:unknown):NormalizedSecurityReport{
  let sarif:z.infer<typeof sarifSchema>;
  try{if(new TextEncoder().encode(JSON.stringify(input)).length>2_000_000)throw new SecurityReportError('SARIF exceeds 2 MB');sarif=sarifSchema.parse(input);}catch(error){if(error instanceof SecurityReportError)throw error;throw new SecurityReportError('A complete SARIF 2.1.0 run with explicit successful invocation and located rule findings is required');}
  const run=sarif.runs[0]!;
  if(run.invocations.some(invocation=>!invocation.executionSuccessful))throw new SecurityReportError('Failed scanner runs cannot resolve alerts');
  const findings:SecurityFinding[]=[];const seen=new Set<string>();
  for(const result of run.results){
    // Scanner-side suppressions must remain visible and triaged in the repository.
    for(const location of result.locations){
      const artifact=location.physicalLocation.artifactLocation;
      let path:string;try{path=decodeURIComponent(artifact.uri);}catch{throw new SecurityReportError('Invalid finding path');}
      if(path.startsWith('/')||path.includes('\\')||path.split('/').some(segment=>!segment||segment==='.'||segment==='..')||/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)||/[\u0000-\u001f?#]/.test(path))throw new SecurityReportError('Finding paths must be repository-relative without traversal');
      if(artifact.uriBaseId!==undefined&&artifact.uriBaseId!=='%SRCROOT%')throw new SecurityReportError('Only repository-root SARIF locations are supported');
      const line=location.physicalLocation.region.startLine;
      const key=JSON.stringify([result.ruleId,path,line]);
      if(seen.has(key))continue;seen.add(key);
      findings.push({key,ruleId:result.ruleId,path,line,level:result.level??'warning'});
    }
  }
  return {tool:run.tool.driver.name,toolVersion:run.tool.driver.version??null,findings};
}

export function applySecurityReport(state:SecurityState,input:SecurityImport,report:NormalizedSecurityReport,actor:string,at=new Date().toISOString()):SecurityState{
  if(input.expectedVersion!==state.version)throw new SecurityReportError('Security reports changed; reload before importing',409);
  if(state.runs.length>=1000||state.alerts.length+report.findings.length>10000)throw new SecurityReportError('Security history capacity reached',413);
  const alerts=structuredClone(state.alerts);const remaining=new Set(report.findings.map(finding=>finding.key));
  const scoped=alerts.filter(alert=>alert.analysisKey===input.analysisKey);
  if(scoped.some(alert=>alert.tool!==report.tool))throw new SecurityReportError('An analysis key belongs to one scanner; use a new key for another scanner');
  const event=(status:SecurityEvent['state'],reason:string):SecurityEvent=>({at,actor,state:status,reason,commit:input.commit});
  for(const alert of scoped){
    const finding=report.findings.find(candidate=>candidate.key===alert.key);
    if(finding){remaining.delete(alert.key);alert.lastCommit=input.commit;alert.level=finding.level;if(alert.state==='resolved'){alert.state='open';alert.events.push(event('open','Detected again by a complete scanner run'));}}
    else if(alert.state!=='resolved'){alert.state='resolved';alert.lastCommit=input.commit;alert.events.push(event('resolved','Absent from the next complete run of this analysis'));}
    if(alert.events.length>1000)throw new SecurityReportError('Alert history capacity reached',413);
  }
  for(const finding of report.findings)if(remaining.has(finding.key))alerts.push({...finding,id:crypto.randomUUID(),analysisKey:input.analysisKey,tool:report.tool,state:'open',firstCommit:input.commit,lastCommit:input.commit,events:[event('open','Detected by scanner')]});
  return {version:state.version+1,alerts,runs:[...state.runs,{id:crypto.randomUUID(),analysisKey:input.analysisKey,tool:report.tool,toolVersion:report.toolVersion,commit:input.commit,tree:input.tree,source:'member-upload',coverage:input.coverage,at,actor,findingCount:report.findings.length}]};
}

export function triageSecurityAlert(state:SecurityState,id:string,input:SecurityTriage,actor:string,at=new Date().toISOString()):SecurityState{
  if(input.expectedVersion!==state.version)throw new SecurityReportError('Security alerts changed; reload before triage',409);
  const alerts=structuredClone(state.alerts),alert=alerts.find(candidate=>candidate.id===id);
  if(!alert)throw new SecurityReportError('Security alert not found',404);
  if(alert.state==='resolved')throw new SecurityReportError('Only a scanner run can reopen a resolved alert',409);
  if(alert.events.length>=1000)throw new SecurityReportError('Alert history capacity reached',413);
  alert.state=input.state;alert.events.push({at,actor,state:input.state,reason:input.reason,commit:alert.lastCommit});
  return {...state,version:state.version+1,alerts};
}
