import { isSafeRef, isSafeSha } from "../core/sanitize.js";
import { gitAuthEnv, q } from "./shell.js";

/** One-way copy of accepted work to GitHub. FlareGit stays the source of truth; failures are recorded, never blocking. */

export type MirrorStatus = "ok" | "diverged" | "auth_failed" | "error";
export interface MirrorResult { status: MirrorStatus; detail: string }
export interface ExecResult { success: boolean; exitCode?: number; stdout: string; stderr: string }
export type Exec = (cmd: string, env?: Record<string, string>) => Promise<ExecResult>;

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/** Accepts only https://github.com/<owner>/<repo>(.git); returns https://github.com/<owner>/<repo>.git or null. */
export function validateMirrorTarget(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 200) return null;
  const m = /^https:\/\/github\.com\/([^/?#@:\s]+)\/([^/?#@:\s]+?)(?:\.git)?\/?$/.exec(input.trim());
  if (!m) return null;
  const [, owner = "", repo = ""] = m;
  if (!OWNER.test(owner) || owner.includes("--") || !REPO.test(repo) || repo === "." || repo === ".." || repo.endsWith(".git")) return null;
  return `https://github.com/${owner}/${repo}.git`;
}

export const isPlausibleGithubToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_]{20,255}$/.test(t);

/** GitHub token reaches git only via env (http.extraHeader), scoped to github.com; never argv or URL. */
export function githubAuthEnv(token: string): Record<string, string> {
  return {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${btoa(`x-access-token:${token}`)}`,
  };
}

export function redact(text: string, ...secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (!s) continue;
    out = out.replaceAll(s, "[redacted]").replaceAll(btoa(`x-access-token:${s}`), "[redacted]");
  }
  return out.slice(0, 2000);
}

export interface PushMirrorInput {
  canonicalRemote: string;
  canonicalToken: string;
  target: string;
  githubToken: string;
  branch: string;
  commit: string;
  workdir?: string;
}

/** Fetches the accepted branch from canonical, verifies it is `commit`, and fast-forwards GitHub. Never forces. */
export async function pushMirror(deps: { exec: Exec }, input: PushMirrorInput): Promise<MirrorResult> {
  const { exec } = deps;
  const target = validateMirrorTarget(input.target);
  if (!target) return { status: "error", detail: "Mirror target is not a GitHub repository URL" };
  if (!isSafeRef(input.branch)) return { status: "error", detail: "Unsafe branch name" };
  if (!isSafeSha(input.commit)) return { status: "error", detail: "Invalid commit id" };
  const secrets = [input.githubToken, input.canonicalToken];
  const fail = (status: MirrorStatus, r: ExecResult | string): MirrorResult => ({ status, detail: redact(typeof r === "string" ? r : `${r.stderr}\n${r.stdout}`.trim(), ...secrets) });
  const dir = input.workdir ?? "/tmp/mirror";
  const ref = `refs/flaregit/mirror`;

  const init = await exec(`rm -rf ${q(dir)} && git init --quiet --bare ${q(dir)}`);
  if (!init.success) return fail("error", init);
  const fetched = await exec(`git -C ${q(dir)} fetch --quiet --no-tags ${q(input.canonicalRemote)} ${q(`+refs/heads/${input.branch}:${ref}`)}`, gitAuthEnv(input.canonicalToken));
  if (!fetched.success) return fail("error", fetched);
  const head = (await exec(`git -C ${q(dir)} rev-parse ${q(ref)}`)).stdout.trim();
  if (head !== input.commit) return fail("error", `Canonical ${input.branch} is at ${head || "unknown"}, expected ${input.commit}; a newer landing will mirror instead`);

  const pushed = await exec(`git -C ${q(dir)} push --porcelain ${q(target)} ${q(`${input.commit}:refs/heads/${input.branch}`)}`, githubAuthEnv(input.githubToken));
  if (pushed.success) return { status: "ok", detail: `Mirrored ${input.commit.slice(0, 12)} to ${input.branch}` };
  const text = `${pushed.stderr}\n${pushed.stdout}`;
  if (/non-fast-forward|fetch first|\[rejected\]|stale info|updates were rejected/i.test(text)) return fail("diverged", `GitHub ${input.branch} has commits FlareGit does not; nothing was overwritten.\n${text}`);
  if (/\b40[13]\b|authentication failed|could not read username|permission to .* denied|invalid username or password|write access to repository not granted/i.test(text)) return fail("auth_failed", text);
  return fail("error", pushed);
}
