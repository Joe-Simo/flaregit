import type { Env } from "./env.js";
import { admitNativeCompute } from "./native-compute.js";
import { validateRecoveryRemote } from "./private-recovery-bundle.js";

/**
 * Execution ports for coordination work (contradiction proofs and post-land rebases). Production uses one
 * funded platform integrator container per operation and short-lived Artifacts tokens that are revoked
 * when the operation ends. Repository code only ever runs without credentials in its environment.
 */
export interface ShellResult { success: boolean; stdout: string; stderr: string }
export interface ShellRuntime {
  exec(command: string, env?: Record<string, string>): Promise<ShellResult>;
  close(): Promise<void>;
}
export interface RepositoryCredential { remote: string; token: string; close(): Promise<void> }
export interface CoordinationRuntime {
  /** Directory holding the platform checkout (probe runner and protected verifier). */
  readonly platformDir: string;
  /** Scratch directory inside the runtime for checkouts. */
  readonly workDir: string;
  shell(label: string): Promise<ShellRuntime>;
  credential(repoName: string, scope: "read" | "write"): Promise<RepositoryCredential>;
}

export const PLATFORM_DIR = "/opt/flaregit";
const TOKEN_SECONDS = 900;

export function nativeCoordinationRuntime(env: Env, accountKey: string): CoordinationRuntime {
  return {
    platformDir: PLATFORM_DIR,
    workDir: "/workspace",
    async shell(label) {
      if (!/^[a-z0-9-]{1,80}$/.test(label)) throw new Error("Invalid coordination runtime label");
      const allocationId = `native-${crypto.randomUUID()}`;
      await admitNativeCompute(env, accountKey, allocationId, "native-essential");
      const sandbox = env.INTEGRATOR.getByName(allocationId);
      return {
        exec: async (command, commandEnv) => {
          const result = await sandbox.exec(["sh", "-c", command], { env: commandEnv });
          return { success: result.success, stdout: result.stdout, stderr: result.stderr };
        },
        close: async () => { await sandbox.destroy().catch(() => console.warn(`Coordination runtime ${label} shutdown is unconfirmed`)); },
      };
    },
    async credential(repoName, scope) {
      using repository = await env.ARTIFACTS.get(repoName);
      const remote = String((await repository.info()).remote);
      validateRecoveryRemote(remote);
      const issued = await repository.createToken(scope, TOKEN_SECONDS);
      return {
        remote,
        token: issued.plaintext,
        close: async () => {
          try {
            using current = await env.ARTIFACTS.get(repoName);
            if (!await current.revokeToken(issued.plaintext)) console.warn("Coordination credential revocation was not confirmed; it expires on its own");
          } catch {
            console.warn("Coordination credential revocation was not confirmed; it expires on its own");
          }
        },
      };
    },
  };
}
