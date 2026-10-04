import type {IntegrationNativeRuntimeScope} from "./integration-native-runtime.js";
import {projectOf} from "./projects.js";
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.js";
import {ContainerLifetime,MANAGED_CONTAINER_LIFETIME_MS,AGENT_CONTAINER_LIFETIME_MS} from "./container-lifetime.js";
import { fileBytes, MAX_FILE_BYTES } from "./file-bytes.js";
import { BUNDLE_CHUNK_BYTES, MAX_BUNDLE_BYTES } from "./private-recovery-bundle.js";

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
  private lifetime(){return new ContainerLifetime(this.ctx.storage,()=>this.ctx.container,this.maximumLifetimeMs);}
  async lifetimeStatus(){return this.lifetime().status();}
  async seal():Promise<void>{this.lifetime().seal();}
  override async alarm():Promise<void>{await this.lifetime().alarm();}
  private async container() {
    const container = this.ctx.container;
    if (!container) throw new Error("Container binding is not configured");
    await this.lifetime().beforeWork();
    this.lifetime().assertWorkAllowed();
    if (!container.running) {
      // The image comes from the container application bound to this class in wrangler.jsonc.
      container.start({
        entrypoint: ["sleep", "infinity"],
        enableInternet: true, // required for git to the Artifacts remotes
      } as never);
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

/** Separate container class for contributor agents: it never holds integrator or canonical credentials. */
export class AgentSandbox extends IntegratorSandbox {protected override maximumLifetimeMs=AGENT_CONTAINER_LIFETIME_MS;}
