import * as path from "node:path";
import type { CoordinationRuntime } from "../../src/server/coordination-runtime";

/** Real local shell and Git for coordination execution tests; remotes are local repository paths. */
export function localCoordinationRuntime(workDir: string, remotes: Record<string, string>): CoordinationRuntime & { commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    platformDir: path.resolve(import.meta.dirname, "..", ".."),
    workDir,
    async shell() {
      return {
        exec: async (command, env) => {
          commands.push(command);
          const child = Bun.spawn(["sh", "-c", command], { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
          const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
          return { success: code === 0, stdout, stderr };
        },
        close: async () => {},
      };
    },
    async credential(repoName) {
      const remote = remotes[repoName];
      if (!remote) throw new Error(`Unknown local repository ${repoName}`);
      return { remote, token: "local-test-token", close: async () => {} };
    },
  };
}

export async function sh(cwd: string, command: string): Promise<string> {
  const child = Bun.spawn(["sh", "-c", command], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" } });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command} failed: ${stderr}`);
  return stdout.trim();
}
