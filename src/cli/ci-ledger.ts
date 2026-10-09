import {Database} from 'bun:sqlite';
import {chmodSync} from 'node:fs';
import type {ExecutableJob} from '../core/ci-workflow';
export type LocalCiStatus='queued'|'running'|'passed'|'failed'|'cancelled'|'interrupted';
export interface LocalCiScope {repositoryId:string;candidateId:string;commit:string;tree:string;policyVersion:number;runId:string;checkId:string;workflowDigest:string}
export interface LocalCiTerminal {status:'passed'|'failed'|'cancelled';summary:string}
export interface LocalCiJob {id:string;status:LocalCiStatus;log:string;cleanupConfirmed:boolean}
/** Customer-owned SQLite state. A previously claimed job is never silently re-executed after a crash. */
export class LocalCiLedger {
 readonly db:Database;
 constructor(path:string){this.db=new Database(path);if(path!==':memory:')chmodSync(path,0o600);this.db.run('CREATE TABLE IF NOT EXISTS ci_runs(id TEXT PRIMARY KEY,scope TEXT NOT NULL,cancelled INTEGER NOT NULL DEFAULT 0)');this.db.run('CREATE TABLE IF NOT EXISTS ci_receipts(run_id TEXT PRIMARY KEY,status TEXT NOT NULL,summary TEXT NOT NULL)');this.db.run('CREATE TABLE IF NOT EXISTS ci_jobs(run_id TEXT NOT NULL,id TEXT NOT NULL,status TEXT NOT NULL,log TEXT NOT NULL DEFAULT \'\',cleanup INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(run_id,id))');}
 initialize(scope:LocalCiScope,jobs:readonly ExecutableJob[]){this.db.transaction(()=>{const old=this.db.query<{scope:string},[string]>('SELECT scope FROM ci_runs WHERE id=?').get(scope.runId);if(old){if(old.scope!==JSON.stringify(scope))throw Error('Run identity cannot be rebound');return;}this.db.query('INSERT INTO ci_runs(id,scope) VALUES(?,?)').run(scope.runId,JSON.stringify(scope));for(const job of jobs)this.db.query('INSERT INTO ci_jobs(run_id,id,status) VALUES(?,?,?)').run(scope.runId,job.id,'queued');})();}
 jobs(runId:string):LocalCiJob[]{return this.db.query<{id:string;status:LocalCiStatus;log:string;cleanup:number},[string]>('SELECT id,status,log,cleanup FROM ci_jobs WHERE run_id=? ORDER BY id').all(runId).map(item=>({id:item.id,status:item.status,log:item.log,cleanupConfirmed:item.cleanup===1}));}
 claim(runId:string,id:string){return this.db.query('UPDATE ci_jobs SET status=\'running\' WHERE run_id=? AND id=? AND status=\'queued\' AND NOT EXISTS(SELECT 1 FROM ci_runs WHERE id=? AND cancelled=1)').run(runId,id,runId).changes===1;}
 finish(runId:string,id:string,status:LocalCiStatus,log:string,cleanupConfirmed:boolean){if(!['passed','failed','cancelled','interrupted'].includes(status))throw Error('Invalid terminal job status');this.db.query('UPDATE ci_jobs SET status=?,log=?,cleanup=? WHERE run_id=? AND id=? AND status IN(\'queued\',\'running\')').run(status,log.slice(-16000),cleanupConfirmed?1:0,runId,id);}
 cancel(runId:string){this.db.query('UPDATE ci_runs SET cancelled=1 WHERE id=?').run(runId);this.db.query('UPDATE ci_jobs SET status=\'cancelled\',cleanup=1 WHERE run_id=? AND status=\'queued\'').run(runId);}
 cancelled(runId:string){return this.db.query<{cancelled:number},[string]>('SELECT cancelled FROM ci_runs WHERE id=?').get(runId)?.cancelled===1;}
 terminal(runId:string){return this.db.query<LocalCiTerminal,[string]>('SELECT status,summary FROM ci_receipts WHERE run_id=?').get(runId);}
 saveTerminal(runId:string,receipt:LocalCiTerminal){this.db.query('INSERT OR IGNORE INTO ci_receipts(run_id,status,summary) VALUES(?,?,?)').run(runId,receipt.status,receipt.summary);return this.terminal(runId)!;}
 close(){this.db.close();}
}
