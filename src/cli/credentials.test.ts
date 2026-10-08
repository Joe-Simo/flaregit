import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { credentialOrigin, saveCredentials } from "./credentials";

test("actual CLI accepts piped credentials, saves privately, reports status and logs out", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flaregit-login-"));
  const token = `fgt_123456789abc_${"a".repeat(32)}`;
  const server = Bun.serve({ port: 0, fetch(request) {
    if (request.headers.get("Authorization") !== `Bearer ${token}`) return new Response("Rejected", { status: 401 });
    return Response.json({ projects: [], plan: "free", runsToday: 0, runsPerDay: 5 });
  } });
  const run = async (args: string[], input?: string) => {
    const child = Bun.spawn([process.execPath, path.resolve(import.meta.dir, "../../cli/flaregit.ts"), ...args], { env: { ...process.env, XDG_CONFIG_HOME: dir, FLAREGIT_API: `http://127.0.0.1:${server.port}`, FLAREGIT_TOKEN: undefined }, stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(child.stdout).text(), stderr = await new Response(child.stderr).text();
    return { status: await child.exited, stdout, stderr };
  };
  try {
    const login = await run(["auth", "login", "--stdin"], `${token}\n`);
    expect(login.status).toBe(0); expect(login.stdout).not.toContain(token); expect(login.stderr).not.toContain(token);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "flaregit/config.json"), "utf8")).token).toBe(token);
    const status = await run(["auth", "status"]); expect(status.status).toBe(0); expect(JSON.parse(status.stdout).signedIn).toBe(true);
    const logout = await run(["auth", "logout"]); expect(logout.status).toBe(0);
    expect(fs.existsSync(path.join(dir, "flaregit/config.json"))).toBe(false);
  } finally { server.stop(true); fs.rmSync(dir, { recursive: true, force: true }); }
}, 20000);

test("credential transport rejects remote plaintext and credential-bearing URLs", () => {
  for (const origin of ["http://flaregit.com", "https://token@example.com", "https://example.com/api", "https://example.com?token=secret", "file:///tmp/api"]) expect(() => credentialOrigin(origin)).toThrow();
  expect(credentialOrigin("https://example.com/")).toBe("https://example.com");
  expect(credentialOrigin("http://127.0.0.1:4310")).toBe("http://127.0.0.1:4310");
  expect(credentialOrigin("http://[::1]:4310")).toBe("http://[::1]:4310");
});

test("credential replacement repairs a permissive old file and does not follow a symlink", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flaregit-credentials-"));
  try {
    const file = path.join(dir, "config.json"), target = path.join(dir, "unrelated");
    fs.writeFileSync(target, "preserved");
    fs.symlinkSync(target, file);
    saveCredentials(file, { api: "https://example.com", token: "private" });
    expect(fs.readFileSync(target, "utf8")).toBe("preserved");
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(false);
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    fs.chmodSync(file, 0o644);
    saveCredentials(file, { api: "https://example.com", token: "replacement" });
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(dir).sort()).toEqual(["config.json", "unrelated"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
