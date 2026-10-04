import {z} from 'zod';
import {agentNativeAttemptSchema,type AgentNativeAttemptIdentity} from './agent-runtime-ledger';
import {agentExecutionEgressScopeSchema,type AgentExecutionEgressScope} from './agent-execution-egress';
import {agentEgressWorkerPropsSchema,type AgentEgressWorkerProps} from './agent-egress-worker';
import {validateRecoveryRemote} from './private-recovery-bundle';
import type {IntegrationNativeRuntimeScope} from "./integration-native-runtime.js";
import {projectOf} from "./projects.js";
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.js";
import {ContainerLifetime,MANAGED_CONTAINER_LIFETIME_MS,AGENT_CONTAINER_LIFETIME_MS} from "./container-lifetime.js";
import { fileBytes, MAX_FILE_BYTES } from "./file-bytes.js";
import { BUNDLE_CHUNK_BYTES, MAX_BUNDLE_BYTES } from "./private-recovery-bundle.js";
import {READ_GIT_OBJECT} from './git-object-read-command';

const DEC = new TextDecoder();

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Platform-owned integrator container (one per candidate). Holds the integration checkout and runs the
 * protected verifier. It is never handed to contributors or agents, and git credentials are passed only
 * in the environment of the single `exec` that needs them.
 */
export class IntegratorSandbox extends DurableObject<Env> {
  protected maximumLifetimeMs=MANAGED_CONTAINER_LIFETIME_MS;
  protected nativeContainer():Container|undefined{return this.ctx.container;}
  protected lifetime(){return new ContainerLifetime(this.ctx.storage,()=>this.nativeContainer(),this.maximumLifetimeMs);}
  async lifetimeStatus(){return this.lifetime().status();}
  async seal():Promise<void>{this.lifetime().seal();}
  override async alarm():Promise<void>{await this.lifetime().alarm();}
  protected async startupOptions():Promise<ContainerStartupOptions>{return {entrypoint:['sleep','infinity'],enableInternet:true};}
  protected async assertContainerAccess():Promise<void>{}
  private async container() {
    await this.assertContainerAccess();
    const container = this.nativeContainer();
    if (!container) throw new Error("Container binding is not configured");
    await this.lifetime().beforeWork();
    this.lifetime().assertWorkAllowed();
    if (!container.running) {
      // Subclasses must establish their own network boundary before startup.
      const options=await this.startupOptions();
      this.lifetime().assertWorkAllowed();
      container.start(options);
    }
    return container;
  }

  /** A freshly started container takes a moment to accept exec; retry only while it is still starting. */
  private async execWhenReady(argv: string[], options: ContainerExecOptions) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const container=await this.container();
        this.lifetime().assertWorkAllowed();
        return await container.exec(argv, options);
      } catch (err) {
        lastError = err;
        if (!/not (been )?started|not running|starting/i.test(String(err))) throw err;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    throw lastError;
  }

  async exec(argv: string[], opts?: { env?: Record<string, string>; cwd?: string; timeoutMs?: number }): Promise<ExecResult> {
    const proc = await this.execWhenReady(argv, {
      env: opts?.env,
      cwd: opts?.cwd,
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 10 * 60_000),
    });
    const out = await proc.output();
    return { success: out.exitCode === 0, stdout: DEC.decode(out.stdout), stderr: DEC.decode(out.stderr), exitCode: out.exitCode };
  }

  private async runIntegrationCommand<T>(scope:IntegrationNativeRuntimeScope,nativeId:string,commandId:string,payload:unknown,action:()=>Promise<T>):Promise<T>{
    const project=projectOf(this.env,scope.projectId);
    if(this.ctx.id.toString()!==this.env.INTEGRATOR.idFromName(`native-${nativeId}`).toString())throw new Error("Native command destination changed");
    const encoded=JSON.stringify({scope,nativeId,payload}),digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(encoded)))).map(value=>value.toString(16).padStart(2,"0")).join("");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS integration_command_dispatch(command_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,state TEXT NOT NULL)");
    this.ctx.storage.transactionSync(()=>{const old=this.ctx.storage.sql.exec<{payload_hash:string}>("SELECT payload_hash FROM integration_command_dispatch WHERE command_id=?",commandId).toArray()[0];if(old)throw new Error(old.payload_hash===digest?"Native command already dispatched; its outcome is retained":"Native command identity belongs to another payload");this.ctx.storage.sql.exec("INSERT INTO integration_command_dispatch VALUES(?,?,'started')",commandId,digest);});
    let allowed=false;try{allowed=await project.integrationNativeCommandAllowed(scope,nativeId,commandId);}catch{/* No native dispatch occurred. */}
    if(!allowed){await project.finishIntegrationNativeCommand(scope,nativeId,commandId,"refused");this.ctx.storage.sql.exec("UPDATE integration_command_dispatch SET state='refused' WHERE command_id=?",commandId);throw new Error("Sealed or revoked native command refused");}
    // Completion is stored here, before replying to a possibly interrupted caller.
    // Unknown execution failures retain the admitted permit and block handoff.
    const result=await action();await project.finishIntegrationNativeCommand(scope,nativeId,commandId,"completed");this.ctx.storage.sql.exec("UPDATE integration_command_dispatch SET state='completed' WHERE command_id=?",commandId);return result;
  }
  async integrationExec(scope:IntegrationNativeRuntimeScope,nativeId:string,commandId:string,argv:string[],opts?:{env?:Record<string,string>;timeoutMs?:number}){return this.runIntegrationCommand(scope,nativeId,commandId,{kind:"exec",argv,opts:opts?{timeoutMs:opts.timeoutMs,env:opts.env?Object.fromEntries(Object.entries(opts.env).sort(([a],[b])=>a.localeCompare(b))):undefined}:undefined},()=>this.exec(argv,opts));}
  async integrationReadFile(scope:IntegrationNativeRuntimeScope,nativeId:string,commandId:string,path:string){return this.runIntegrationCommand(scope,nativeId,commandId,{kind:"readFile",path},()=>this.readFile(path));}
  async integrationReadFileBytes(scope:IntegrationNativeRuntimeScope,nativeId:string,commandId:string,path:string){return this.runIntegrationCommand(scope,nativeId,commandId,{kind:"readFileBytes",path},()=>this.readFileBytes(path));}
  async integrationReadGitObject(scope:IntegrationNativeRuntimeScope,nativeId:string,commandId:string,kind:'commit'|'tree'|'blob',hash:string,maxBytes:number){
    if(!['commit','tree','blob'].includes(kind)||!/^[a-f0-9]{40}$/.test(hash)||hash==='0'.repeat(40)||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_FILE_BYTES)throw Error('Invalid Git object read');
    return this.runIntegrationCommand(scope,nativeId,commandId,{kind:'readGitObject',objectKind:kind,hash,maxBytes},async()=>{
      const proc=await this.execWhenReady(['/usr/local/bin/bun','-e',READ_GIT_OBJECT,kind,hash,String(maxBytes)],{signal:AbortSignal.timeout(30000),stderr:'ignore'});
      const output=await proc.output();
      if(output.exitCode!==0||output.stdout.byteLength>maxBytes)throw Error('Bounded Git object unavailable');
      return new Uint8Array(output.stdout);
    });
  }
  async integrationWriteFile(scope:IntegrationNativeRuntimeScope,nativeId:string,commandId:string,path:string,content:string){return this.runIntegrationCommand(scope,nativeId,commandId,{kind:"writeFile",path,content},()=>this.writeFile(path,content));}

  async readFile(path: string): Promise<string> {
    const r = await this.exec(["cat", path]);
    if (!r.success) throw new Error(`read ${path} failed`);
    return r.stdout;
  }

  /** Binary-safe RPC read. Bound the container output before collecting it in Worker memory. */
  async readFileBytes(path: string): Promise<Uint8Array> {
    const proc = await this.execWhenReady(["head", "-c", String(MAX_FILE_BYTES + 1), "--", path], { signal: AbortSignal.timeout(30_000) });
    return fileBytes(await proc.output(), path);
  }

  /** Reads bounded binary chunks from a verified recovery artifact, never source files. */
  async readFileChunk(path: string, offset: number, length: number): Promise<Uint8Array> {
    if (!/^\/tmp\/flaregit-private-recovery-[a-f0-9-]{36}\/repository\.bundle$/.test(path) || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1 || length > BUNDLE_CHUNK_BYTES || offset + length > MAX_BUNDLE_BYTES) throw new Error("Invalid recovery chunk");
    const proc = await this.execWhenReady(["bun", "-e", "const [path,offset,length]=Bun.argv.slice(1);const file=Bun.file(path);await Bun.write(Bun.stdout,file.slice(Number(offset),Number(offset)+Number(length)));", path, String(offset), String(length)], { signal: AbortSignal.timeout(30_000) });
    const output = await proc.output();
    if (output.exitCode !== 0 || output.stdout.byteLength !== length) throw new Error("Recovery chunk unavailable");
    return new Uint8Array(output.stdout);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const proc = await this.execWhenReady(["tee", path], { stdin: "pipe", stdout: "ignore" });
    const writer = proc.stdin!.getWriter();
    await writer.write(new TextEncoder().encode(content));
    await writer.close();
    if ((await proc.exitCode) !== 0) throw new Error(`write ${path} failed`);
  }

  async destroy(): Promise<void> {
    await this.lifetime().stop();
  }
}

const AGENT_CA='/etc/cloudflare/certs/cloudflare-containers-ca.crt';
export const AGENT_CA_PROBE=['/bin/sh','-c',`openssl x509 -in ${AGENT_CA} -noout -checkend 0 >/dev/null 2>&1 && openssl x509 -in ${AGENT_CA} -noout -ext basicConstraints 2>/dev/null | grep -Eq '(^|[[:space:]])CA:TRUE([[:space:]]|$)'`];
const agentConfigSchema=z.object({attempt:agentNativeAttemptSchema,scope:agentExecutionEgressScopeSchema,image:z.string().regex(/^registry\.cloudflare\.com\/[a-f0-9]{32}\/[a-z0-9-]+@sha256:[a-f0-9]{64}$/),phase:z.enum(['installing','ready','sealed']),revision:z.number().int().positive()}).strict();
type AgentConfig=z.infer<typeof agentConfigSchema>;
function agentIdentity(input:AgentNativeAttemptIdentity){return agentNativeAttemptSchema.parse({attemptId:input.attemptId,nativeId:input.nativeId,projectId:input.projectId,incarnation:input.incarnation,workflowId:input.workflowId,runId:input.runId,taskId:input.taskId,actorId:input.actorId,accountKey:input.accountKey,phase:input.phase,generation:input.generation,snapshotDigest:input.snapshotDigest});}
async function agentBounded<T>(operation:Promise<T>,signal:AbortSignal){signal.throwIfAborted();let abort:()=>void=()=>{};try{return await Promise.race([operation,new Promise<never>((_,reject)=>{abort=()=>reject(Error('Restricted agent configuration deadline'));signal.addEventListener('abort',abort,{once:true});})]);}finally{signal.removeEventListener('abort',abort);}}
/** Separate per-attempt job. Credentials exist only in its scoped Worker loopback. */
export class AgentSandbox extends IntegratorSandbox {
 protected override maximumLifetimeMs=AGENT_CONTAINER_LIFETIME_MS;
 private config():AgentConfig|null{const row=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='restricted_agent_config'").toArray().length?this.ctx.storage.sql.exec<{doc:string}>('SELECT doc FROM restricted_agent_config WHERE id=1').toArray()[0]:undefined;return row?agentConfigSchema.parse(JSON.parse(row.doc)):null;}
 private saveConfig(value:AgentConfig){this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS restricted_agent_config(id INTEGER PRIMARY KEY CHECK(id=1),doc TEXT NOT NULL)');this.ctx.storage.sql.exec('INSERT INTO restricted_agent_config VALUES(1,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc',JSON.stringify(value));}
 protected restrictedLoopback(props:AgentEgressWorkerProps):Fetcher{return this.ctx.exports.AgentEgressWorker({props});}
 protected async restrictedCurrent(props:AgentEgressWorkerProps){return projectOf(this.env,props.scope.projectId).agentRelayCurrent(props);}
 private props(attempt:AgentNativeAttemptIdentity,scope:AgentExecutionEgressScope){for(const key of ['projectId','incarnation','workflowId','runId','taskId','actorId','accountKey'] as const)if(attempt[key]!==scope[key])throw Error('Agent relay attempt and scope differ');if(this.env.AGENT.idFromName('agent-'+attempt.nativeId).toString()!==this.ctx.id.toString())throw Error('Agent namespace identity differs');validateRecoveryRemote(scope.remote);return agentEgressWorkerPropsSchema.parse({attemptId:attempt.attemptId,nativeId:attempt.nativeId,scope});}
 private async fresh(props:AgentEgressWorkerProps){if(this.env.AGENT_RESTRICTED_EGRESS_ENABLED!=='true')throw Error('Restricted agent mode is not enabled');const actual=await this.restrictedCurrent(props),{actorActive,accountActive,taskActive,...scope}=actual;if(!actorActive||!accountActive||!taskActive||JSON.stringify(agentExecutionEgressScopeSchema.parse(scope))!==JSON.stringify(props.scope))throw Error('Restricted agent authority changed');}
 async configureRestrictedAgent(input:AgentNativeAttemptIdentity,provided:AgentExecutionEgressScope){const attempt=agentIdentity(input),scope=agentExecutionEgressScopeSchema.parse(provided),props=this.props(attempt,scope),image=this.env.ISOLATED_AGENT_IMAGE;const desired=agentConfigSchema.parse({attempt,scope,image,phase:'installing',revision:1});const previous=this.config();if(previous){const old={...previous,scope:{...previous.scope,access:'read' as const,expectedTip:null},phase:'installing' as const,revision:1},next={...desired,scope:{...desired.scope,access:'read' as const,expectedTip:null}};if(JSON.stringify(old)!==JSON.stringify(next)||previous.phase!=='ready'||previous.scope.access==='write'&&scope.access!=='write')throw Error('Agent relay cannot migrate or reuse an uncertain configuration');if(previous.scope.access===scope.access){await this.assertRestrictedAgent(attempt,scope);return {configured:true,internet:false,httpIntercept:true,httpsIntercept:true,caTrusted:true};}desired.revision=previous.revision+1;}
 const signal=AbortSignal.timeout(30000),container=this.nativeContainer();if(!container)throw Error('Agent container binding unavailable');await agentBounded(this.fresh(props),signal);if(!previous&&(container.running||await agentBounded(container.inspect(),signal)!==null))throw Error('Existing legacy agent VM cannot be migrated');this.saveConfig(desired);const local=()=>{signal.throwIfAborted();this.lifetime().assertWorkAllowed();if(JSON.stringify(this.config())!==JSON.stringify(desired)||this.env.ISOLATED_AGENT_IMAGE!==image||this.env.AGENT_RESTRICTED_EGRESS_ENABLED!=='true')throw Error('Agent relay configuration changed');};
 await agentBounded(this.lifetime().beforeWork(),signal);local();const relay=this.restrictedLoopback(props);await agentBounded(container.interceptAllOutboundHttp(relay),signal);local();await agentBounded(container.interceptOutboundHttps('*',relay),signal);local();await agentBounded(this.fresh(props),signal);local();if(!previous)container.start({entrypoint:['sleep','infinity'],enableInternet:false,image});const ca=await agentBounded(container.exec(AGENT_CA_PROBE,{stdout:'ignore',stderr:'ignore',signal}),signal);if(await agentBounded(ca.exitCode,signal)!==0)throw Error('Managed agent CA is unavailable');const inspected=await agentBounded(container.inspect(),signal);await agentBounded(this.fresh(props),signal);local();if(!container.running||inspected?.image!==image)throw Error('Pinned agent VM image differs');this.saveConfig({...desired,phase:'ready'});return {configured:true,internet:false,httpIntercept:true,httpsIntercept:true,caTrusted:true};
 }
 async assertRestrictedAgent(input:AgentNativeAttemptIdentity,provided:AgentExecutionEgressScope){const attempt=agentIdentity(input),scope=agentExecutionEgressScopeSchema.parse(provided),props=this.props(attempt,scope),saved=this.config();if(!saved||saved.phase!=='ready'||JSON.stringify(saved.attempt)!==JSON.stringify(attempt)||JSON.stringify(saved.scope)!==JSON.stringify(scope)||saved.image!==this.env.ISOLATED_AGENT_IMAGE)throw Error('Restricted agent configuration is not ready');const signal=AbortSignal.timeout(10000);await agentBounded(this.fresh(props),signal);const inspected=await agentBounded(this.nativeContainer()!.inspect(),signal);await agentBounded(this.fresh(props),signal);if(JSON.stringify(this.config())!==JSON.stringify(saved)||saved.image!==this.env.ISOLATED_AGENT_IMAGE||this.env.AGENT_RESTRICTED_EGRESS_ENABLED!=='true'||inspected?.image!==saved.image||!this.nativeContainer()?.running)throw Error('Restricted agent attempt changed or stopped');}
 async cleanupRestrictedAgent(input:AgentNativeAttemptIdentity){const attempt=agentIdentity(input),saved=this.config();if(!saved||JSON.stringify(saved.attempt)!==JSON.stringify(attempt))throw Error('Exact restricted agent cleanup required');const props=this.props(attempt,saved.scope);this.saveConfig({...saved,phase:'sealed'});this.lifetime().seal();const project=projectOf(this.env,attempt.projectId);let sealed=false;try{await project.sealAgentRelay(props);sealed=true;}catch{/* Unknown Root acknowledgement never claims relay cleanup. */}await super.destroy();const status=await project.agentRelayCleanupStatus(props);return {credentialsRevoked:sealed&&status.credentialsComplete&&this.lifetime().status()?.state==='stopped'};}
 protected override async assertContainerAccess(){if(this.env.AGENT_RESTRICTED_EGRESS_ENABLED==='true'||this.config()){const saved=this.config();if(!saved)throw Error('Restricted agent relay must be configured before container access');await this.assertRestrictedAgent(saved.attempt,saved.scope);}}
 protected override async startupOptions():Promise<ContainerStartupOptions>{if(this.env.AGENT_RESTRICTED_EGRESS_ENABLED==='true'||this.config())throw Error('Restricted agent startup requires the configured fresh allocation');return super.startupOptions();}
 override async exec(argv:string[],opts?:{env?:Record<string,string>;cwd?:string;timeoutMs?:number}):Promise<ExecResult>{if(this.env.AGENT_RESTRICTED_EGRESS_ENABLED==='true'||this.config()){if(Object.values(opts?.env??{}).some(value=>/Authorization:\s*(?:Bearer|Basic)\s/i.test(value))||opts?.env?.GIT_SSL_NO_VERIFY)throw Error('Credentials and disabled TLS cannot enter a restricted agent VM');return super.exec(argv,{...opts,env:{...opts?.env,GIT_SSL_CAINFO:AGENT_CA}});}return super.exec(argv,opts);}
 override async destroy(){const saved=this.config();if(saved){await this.cleanupRestrictedAgent(saved.attempt);return;}return super.destroy();}
}
