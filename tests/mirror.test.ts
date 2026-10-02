import { expect, test } from "bun:test";
import { githubAuthEnv, pushMirror, redact, validateMirrorTarget, type ExecResult } from "../src/server/mirror";

const TOKEN = "github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CTOKEN = "canonical_secret_token_value_123";
const COMMIT = "a".repeat(40);

test("validateMirrorTarget accepts GitHub repos and normalizes", () => {
  expect(validateMirrorTarget("https://github.com/acme/app")).toBe("https://github.com/acme/app.git");
  expect(validateMirrorTarget("https://github.com/acme/app.git")).toBe("https://github.com/acme/app.git");
  expect(validateMirrorTarget("https://github.com/a-b/my.repo_1/")).toBe("https://github.com/a-b/my.repo_1.git");
});

test("validateMirrorTarget rejects everything else", () => {
  for (const bad of [
    "http://github.com/acme/app", "https://gitlab.com/acme/app", "https://github.com.evil.com/acme/app",
    "https://user:pw@github.com/acme/app", "https://github.com/acme", "https://github.com/acme/app/tree/main",
    "https://github.com/-acme/app", "https://github.com/acme/..", "https://github.com/acme/app?x=1",
    "https://github.com/ac me/app", "https://github.com/acme/app;rm", "git@github.com:acme/app.git", 42, "",
  ]) expect(validateMirrorTarget(bad)).toBeNull();
});

test("githubAuthEnv keeps the token out of URLs and in plain form", () => {
  const env = githubAuthEnv(TOKEN);
  const all = Object.values(env).join("\n");
  expect(all).not.toContain(TOKEN);
  expect(all).not.toMatch(/https:\/\/[^/]*@/);
  expect(env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${btoa(`x-access-token:${TOKEN}`)}`);
});

test("redact removes raw and encoded token", () => {
  const out = redact(`fail ${TOKEN} and ${btoa(`x-access-token:${TOKEN}`)}`, TOKEN);
  expect(out).not.toContain(TOKEN);
  expect(out).not.toContain(btoa(`x-access-token:${TOKEN}`));
});

function fakeExec(opts: { head?: string; push?: ExecResult }) {
  const cmds: string[] = [];
  const envs: Record<string, string>[] = [];
  const exec = async (cmd: string, env?: Record<string, string>): Promise<ExecResult> => {
    cmds.push(cmd);
    if (env) envs.push(env);
    if (cmd.includes("rev-parse")) return { success: true, stdout: `${opts.head ?? COMMIT}\n`, stderr: "" };
    if (cmd.includes(" push ")) return opts.push ?? { success: true, stdout: "", stderr: "" };
    return { success: true, stdout: "", stderr: "" };
  };
  return { exec, cmds, envs };
}
const input = { canonicalRemote: "https://artifacts.example/repo.git", canonicalToken: CTOKEN, target: "https://github.com/acme/app", githubToken: TOKEN, branch: "main", commit: COMMIT };
const noTokenInArgv = (cmds: string[]) => { for (const c of cmds) { expect(c).not.toContain(TOKEN); expect(c).not.toContain(CTOKEN); } };

test("pushMirror ok: fast-forward push without force", async () => {
  const f = fakeExec({});
  const r = await pushMirror(f, input);
  expect(r.status).toBe("ok");
  const push = f.cmds.find((c) => c.includes(" push "))!;
  expect(push).toContain(`${COMMIT}:refs/heads/main`);
  expect(push).not.toMatch(/--force|\s\+/);
  expect(f.cmds.some((c) => c.includes("blob:none"))).toBe(false);
  noTokenInArgv(f.cmds);
});

test("pushMirror head mismatch is an error and does not push", async () => {
  const f = fakeExec({ head: "b".repeat(40) });
  const r = await pushMirror(f, input);
  expect(r.status).toBe("error");
  expect(f.cmds.some((c) => c.includes(" push "))).toBe(false);
});

test("pushMirror non-fast-forward is diverged", async () => {
  const f = fakeExec({ push: { success: false, stdout: "", stderr: " ! [rejected] main -> main (non-fast-forward)" } });
  expect((await pushMirror(f, input)).status).toBe("diverged");
});

test("pushMirror 401/403 is auth_failed and redacted", async () => {
  for (const stderr of [`fatal: unable to access: The requested URL returned error: 403 ${TOKEN}`, "remote: error 401 Unauthorized"]) {
    const f = fakeExec({ push: { success: false, stdout: "", stderr } });
    const r = await pushMirror(f, input);
    expect(r.status).toBe("auth_failed");
    expect(r.detail).not.toContain(TOKEN);
    noTokenInArgv(f.cmds);
  }
});

test("pushMirror rejects bad inputs before running anything", async () => {
  const f = fakeExec({});
  expect((await pushMirror(f, { ...input, target: "https://evil.com/x/y" })).status).toBe("error");
  expect((await pushMirror(f, { ...input, branch: "a;rm -rf /" })).status).toBe("error");
  expect(f.cmds.length).toBe(0);
});
