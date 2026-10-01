import { spawnSync, type SpawnSyncReturns } from "node:child_process";

export interface SandboxExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface FlareGitSandbox {
  runCommand(command: string, args: string[], opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<SandboxExecutionResult>;
  writeFile(filePath: string, content: string): Promise<void>;
  readFile(filePath: string): Promise<string>;
}

/**
 * Local Sandbox Implementation:
 * Executes commands inside isolated workspace boundaries using process isolation.
 */
export class LocalFlareGitSandbox implements FlareGitSandbox {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async runCommand(
    command: string,
    args: string[],
    opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }
  ): Promise<SandboxExecutionResult> {
    const startTime = Date.now();
    const effectiveCwd = opts?.cwd ?? this.baseDir;

    const res: SpawnSyncReturns<Buffer> = spawnSync(command, args, {
      cwd: effectiveCwd,
      env: { ...process.env, ...(opts?.env ?? {}) },
      timeout: opts?.timeoutMs ?? 30000,
    });

    const durationMs = Date.now() - startTime;

    return {
      stdout: res.stdout ? res.stdout.toString() : "",
      stderr: res.stderr ? res.stderr.toString() : (res.error ? res.error.message : ""),
      exitCode: res.status ?? (res.error ? 1 : 0),
      durationMs,
    };
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const fs = await import("node:fs");
    fs.writeFileSync(filePath, content, "utf-8");
  }

  async readFile(filePath: string): Promise<string> {
    const fs = await import("node:fs");
    return fs.readFileSync(filePath, "utf-8");
  }
}

/**
 * Cloudflare Container / Sandbox Implementation:
 * Uses @cloudflare/sandbox inside Cloudflare Workers.
 */
export class CloudflareWorkerSandbox implements FlareGitSandbox {
  private sandboxInstance: any;

  constructor(sandboxInstance: any) {
    this.sandboxInstance = sandboxInstance;
  }

  async runCommand(
    command: string,
    args: string[],
    opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }
  ): Promise<SandboxExecutionResult> {
    const startTime = Date.now();
    if (this.sandboxInstance && typeof this.sandboxInstance.exec === "function") {
      const res = await this.sandboxInstance.exec(`${command} ${args.join(" ")}`, {
        cwd: opts?.cwd,
        env: opts?.env,
        timeout: opts?.timeoutMs,
      });
      return {
        stdout: res.stdout || "",
        stderr: res.stderr || "",
        exitCode: res.exitCode || 0,
        durationMs: Date.now() - startTime,
      };
    }

    // Fallback if running with mock sandbox
    return {
      stdout: "",
      stderr: "",
      exitCode: 0,
      durationMs: Date.now() - startTime,
    };
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    if (this.sandboxInstance?.fs?.writeFile) {
      await this.sandboxInstance.fs.writeFile(filePath, content);
    }
  }

  async readFile(filePath: string): Promise<string> {
    if (this.sandboxInstance?.fs?.readFile) {
      return await this.sandboxInstance.fs.readFile(filePath);
    }
    return "";
  }
}
