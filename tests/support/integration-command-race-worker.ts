import {RepositoryController} from '../../src/server/durable-object';
import {LegacyRerunHttpFixture} from './legacy-candidate-rerun-http-worker';
import {IntegratorSandbox, type ExecResult} from '../../src/server/integrator';
import {IntegrationNativeRuntimeLedger,type IntegrationNativeRuntimeScope} from '../../src/server/integration-native-runtime';
import {accountKeyFor} from '../../src/server/projects';
import type {Env} from '../../src/server/env';
const nativeId='12345678-1234-4234-8234-123456789abc';
export class CommandRepository extends RepositoryController {
 constructor(ctx:DurableObjectState,env:Env){super(ctx,{...env,INTEGRATION_WORKFLOW:{get:async()=>({status:async()=>({status:"complete"}),terminate:async()=>{}})}} as unknown as Env);}
 async undispatched(){const state=await this.getState();state.candidates={};this.ctx.storage.sql.exec("UPDATE project SET doc=? WHERE id=1",JSON.stringify(state));this.ctx.storage.sql.exec("DELETE FROM project_workflows");await this.registerWorkflow("new-undispatched","integration",undefined,"owner",1);}
 private accountRace:string|undefined;
 async armAccountRace(value:string){this.accountRace=value;}
 override async accountLifecycle(){const value=this.accountRace;this.accountRace=undefined;if(value){const repo=this.env.REPOSITORY_CONTROLLER.getByName("project:p123456789abc") as unknown as CommandRepository;await repo.fixtureChange(value);}return super.accountLifecycle();}
 async fixtureSeed(coverage:boolean){return LegacyRerunHttpFixture.prototype.fixtureSeed.call(this as unknown as LegacyRerunHttpFixture,coverage);}
 async fixtureChange(value:string){if(value==='withdraw'){this.ctx.storage.sql.exec("DELETE FROM members WHERE user_id='owner'");return;}return LegacyRerunHttpFixture.prototype.fixtureChange.call(this as unknown as LegacyRerunHttpFixture,value);}
 async commandCount(){return this.ctx.storage.sql.exec<{count:number}>("SELECT COUNT(*) AS count FROM integration_native_commands").toArray()[0]!.count;}
 async seal(scope:IntegrationNativeRuntimeScope){new IntegrationNativeRuntimeLedger(this.ctx.storage).seal(scope);}
 async snapshot(scope:IntegrationNativeRuntimeScope){return {projectRows:this.ctx.storage.sql.exec<{count:number}>("SELECT COUNT(*) AS count FROM project").toArray()[0]!.count,recovery:new IntegrationNativeRuntimeLedger(this.ctx.storage).recovery(scope),commands:this.ctx.storage.sql.exec('SELECT command_id,outcome FROM integration_native_commands').toArray()};}
}
export class CommandIntegrator extends IntegratorSandbox {
 private releaseBarrier:(()=>void)|undefined;
 private executions=0;
 private stopped=false;
 override async destroy(){this.stopped=true;}
 override async lifetimeStatus(){return {state:this.stopped?"stopped" as const:"armed" as const,firstStartedAt:Date.now(),deadline:Date.now()};}
 override async exec(argv:string[]):Promise<ExecResult>{this.executions++;if(argv[0]==='unknown')throw Error('Synthetic unknown execution');if(argv[0]==='barrier')await new Promise<void>(resolve=>{this.releaseBarrier=resolve;});return {success:true,stdout:'',stderr:'',exitCode:0};}
 async release(){this.releaseBarrier?.();this.releaseBarrier=undefined;}
 async count(){return this.executions;}
}
export default {async fetch(request:Request,env:Env){const url=new URL(request.url),repo=env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as CommandRepository,integrator=env.INTEGRATOR.getByName(`native-${nativeId}`) as unknown as CommandIntegrator;const scope=url.searchParams.get('scope')?JSON.parse(url.searchParams.get('scope')!) as IntegrationNativeRuntimeScope:undefined;try{
 if(url.pathname==='/seed'){await repo.fixtureSeed(url.searchParams.get('coverage')!=='0');const account=env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor('owner')}`) as unknown as CommandRepository;await account.setProfile({handle:'owner',displayName:'Owner',bio:'',joinedAt:'2026-10-03'});return Response.json({ok:true});}
 if(url.pathname==='/undispatched')await repo.undispatched();
 if(url.pathname==='/begin-delete')await repo.beginRepositoryDeletion();
 if(url.pathname==='/cleanup')return Response.json({stopped:await repo.stopIntegrationNativeForDeletion()});
 if(url.pathname==='/destroy-repository')await repo.destroy();
 if(url.pathname==='/admit')return Response.json(await repo.admitIntegrationNativeCommand('original','legacy',nativeId,url.searchParams.get('id')!));
 if(url.pathname==='/seal')await repo.seal(scope!);
 if(url.pathname==='/stop'){await integrator.destroy();await repo.confirmIntegrationNativeRuntimeStopped('original','legacy',nativeId);}
 if(url.pathname==='/arm-account-race'){const account=env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor('owner')}`) as unknown as CommandRepository;await account.armAccountRace(url.searchParams.get('value')!);}
 if(url.pathname==='/exec')return Response.json(await integrator.integrationExec(scope!,nativeId,url.searchParams.get('id')!,[url.searchParams.get('mode')??'normal']));
 if(url.pathname==='/release')await integrator.release();
 if(url.pathname==='/withdraw')await repo.fixtureChange('withdraw');
 if(url.pathname==='/counts')return Response.json({commands:await repo.commandCount(),executions:await integrator.count()});
 if(url.pathname==='/snapshot')return Response.json({...await repo.snapshot(scope!),executions:await integrator.count()});
 return Response.json({ok:true});
 }catch(error){return Response.json({error:String(error)},{status:409});}}};
