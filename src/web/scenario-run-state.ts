import {checkedWorkflowObservation,type WorkflowStatus} from './workflow-run-state';
export interface SavedScenarioRun {act:string;instanceId:string|null}
export function checkedScenarioDiscovery(value:unknown,currentCursor:string|null=null,seenIds:ReadonlySet<string>=new Set()):{runs:Array<{instanceId:string}>;nextCursor:string|null}{
 if(typeof value!=='object'||value===null||!('runs'in value)||!Array.isArray(value.runs)||value.runs.length>20||!('nextCursor'in value)||(value.nextCursor!==null&&typeof value.nextCursor!=='string')||!('source'in value)||value.source!=='repository-ledger'||!('providerVerified'in value)||value.providerVerified!==false)throw Error('Scenario inventory was not confirmed.');
 const next=value.nextCursor;
 if(next!==null&&(!/^[1-9][0-9]*$/.test(next)||!Number.isSafeInteger(Number(next))||(currentCursor!==null&&Number(next)>=Number(currentCursor))))throw Error('Scenario inventory cursor did not advance.');
 const runs=value.runs.map((run:unknown)=>({instanceId:checkedScenarioDispatch(run)}));if(new Set(runs.map(run=>run.instanceId)).size!==runs.length||runs.some(run=>seenIds.has(run.instanceId)))throw Error('Scenario inventory repeated an identity.');return {runs,nextCursor:value.nextCursor};
}
export function checkedScenarioDispatch(value:unknown):string {if(typeof value!=='object'||value===null||!('instanceId'in value)||typeof value.instanceId!=='string'||!/^scn-[a-z0-9]{12,16}-[a-f0-9-]{36}$/.test(value.instanceId))throw Error('Scenario dispatch was not confirmed.');return value.instanceId;}
export function scenarioFinished(status:WorkflowStatus|null):boolean{return status!==null&&['complete','errored','terminated'].includes(status);}
export function checkedScenarioStatus(value:unknown,id:string):WorkflowStatus{const observation=checkedWorkflowObservation(value,id,'scenario');if(observation.action!=='status')throw Error('Scenario status request did not match.');return observation.status;}

export function scenarioPreparationBanner(run:SavedScenarioRun|null,status:WorkflowStatus|null):{stage:'working'|'blocked';message:string;detail:string}|null{
 if(!run||scenarioFinished(status))return null;
 return status==='running'||status==='queued'?{stage:'working',message:'Scenario contributions are being prepared',detail:'The provider reports this saved run as '+status+'. The accepted repository is preserved.'}:{stage:'blocked',message:'Scenario status needs checking',detail:'The accepted repository is preserved. Check the saved run before starting another scenario.'};
}
