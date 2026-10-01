import { spawnSync } from "node:child_process";

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Run git non-interactively (never prompts for credentials, never reads user config). */
export function git(repoDir: string, args: string[], opts?: { gitDir?: boolean }): GitResult {
  const base = opts?.gitDir ? ["--git-dir", repoDir] : ["-C", repoDir];
  const res = spawnSync("git", [...base, ...args], {
    encoding: "utf-8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: res.status === 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

export function gitOrThrow(repoDir: string, args: string[], opts?: { gitDir?: boolean }): string {
  const res = git(repoDir, args, opts);
  if (!res.ok) throw new Error(`git ${args.join(" ")} failed: ${res.stderr.trim()}`);
  return res.stdout.trim();
}

/**
 * Credentials for HTTPS Artifacts remotes travel as a Bearer header, never inside the URL, so they
 * cannot leak through remotes, logs or error messages that echo the URL.
 */
export function authArgs(remote: string, token?: string): string[] {
  return token && /^https:\/\//.test(remote) ? ["-c", `http.extraHeader=Authorization: Bearer ${token}`] : [];
}

export const PLATFORM_IDENTITY = [
  "-c",
  "user.name=FlareGit Integrator",
  "-c",
  "user.email=integrator@flaregit.com",
];

export function changedFiles(repoDir: string, from: string, to: string): string[] {
  const res = git(repoDir, ["diff", "--name-only", `${from}..${to}`]);
  return res.stdout.split("\n").filter(Boolean);
}
