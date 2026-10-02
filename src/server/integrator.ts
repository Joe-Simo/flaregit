import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.js";
import { fileBytes, MAX_FILE_BYTES } from "./file-bytes.js";

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
  private container() {
    const container = this.ctx.container;
    if (!container) throw new Error("Container binding is not configured");
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
        return await this.container().exec(argv, options);
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

  async writeFile(path: string, content: string): Promise<void> {
    const proc = await this.execWhenReady(["tee", path], { stdin: "pipe", stdout: "ignore" });
    const writer = proc.stdin!.getWriter();
    await writer.write(new TextEncoder().encode(content));
    await writer.close();
    if ((await proc.exitCode) !== 0) throw new Error(`write ${path} failed`);
  }

  async destroy(): Promise<void> {
    await this.ctx.container?.destroy();
  }
}

/** Separate container class for contributor agents: it never holds integrator or canonical credentials. */
export class AgentSandbox extends IntegratorSandbox {}
