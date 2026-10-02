import { nativeFunding } from "./support/native-funding.js";
import { expect, test } from "bun:test";
import { ensureBuild } from "../src/server/build.js";
import type { Env } from "../src/server/env.js";

function fixture(failAsset = false) {
  const names: string[] = [], writes: string[] = [], revoked: string[] = [];
  let destroyed = 0;
  const env = {
    ...nativeFunding(),
    EVIDENCE_BUCKET: {
      head: async () => null,
      put: async (key: string) => { if (failAsset && key.endsWith("app.js")) throw new Error("R2 unavailable"); writes.push(key); },
    },
    ARTIFACTS: { get: async () => ({ info: async () => ({ remote: "https://repo.example/git" }), createToken: async () => ({ plaintext: "read-token" }), revokeToken: async (token: string) => { revoked.push(token); } }) },
    INTEGRATOR: { getByName: (name: string) => {
      names.push(name);
      return {
        exec: async (argv: string[]) => ({ success: true, stderr: "", stdout: argv[2]?.includes("find .") ? "./index.html\n./app.js\n" : "" }),
        readFile: async () => "asset", readFileBytes: async () => new TextEncoder().encode("asset"), destroy: async () => { destroyed++; },
      };
    } },
  } as unknown as Env;
  return { env, names, writes, revoked, destroyed: () => destroyed };
}

test("concurrent builds have isolated containers and publish readiness last", async () => {
  const f = fixture();
  await Promise.all([ensureBuild(f.env, "p", "a".repeat(40), "repo", "test_account"), ensureBuild(f.env, "p", "b".repeat(40), "repo", "test_account")]);
  expect(new Set(f.names).size).toBe(2);
  for (const commit of ["a".repeat(40), "b".repeat(40)]) {
    const outputs = f.writes.filter((key) => key.includes(commit));
    expect(outputs.map((key) => key.split("/").at(-1))).toEqual(["app.js", "index.html"]);
  }
  expect(f.revoked).toHaveLength(2);
  expect(f.destroyed()).toBe(2);
});

test("failed asset upload leaves preview unready and cleans credentials and container", async () => {
  const f = fixture(true);
  await expect(ensureBuild(f.env, "p", "a".repeat(40), "repo", "test_account")).rejects.toThrow("R2 unavailable");
  expect(f.writes).toEqual([]);
  expect(f.revoked).toEqual(["read-token"]);
  expect(f.destroyed()).toBe(1);
});

test("same committed preview uses one funded build despite concurrent readers", async () => {
  const f = fixture();
  await Promise.all([ensureBuild(f.env,"p","a".repeat(40),"repo","test_account"),ensureBuild(f.env,"p","a".repeat(40),"repo","test_account")]);
  expect(f.names).toHaveLength(1);
  expect(f.destroyed()).toBe(1);
});

test("exhausted native budget refuses build before VM allocation", async () => {
  const f=fixture(); f.env.MANAGED_ACCOUNT_MONTHLY_USD_MICROS="0";
  await expect(ensureBuild(f.env,"p","a".repeat(40),"repo","test_account")).rejects.toThrow("budget unavailable");
  expect(f.names).toHaveLength(0);
});

test("persisted failed preview cannot be relaunched by repeated page reads", async () => {
  const f=fixture(true);
  await expect(ensureBuild(f.env,"p","a".repeat(40),"repo","test_account")).rejects.toThrow();
  await expect(ensureBuild(f.env,"p","a".repeat(40),"repo","test_account")).rejects.toThrow("owner retry");
  expect(f.names).toHaveLength(1);
});
