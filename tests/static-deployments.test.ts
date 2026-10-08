import {expect, test} from "bun:test";
import {InMemoryDeploymentStore, MAX_SITE_BYTES, type DeploymentResult, type Environment, type Site} from "../src/core/deployments";

const docs: Site = {name: "docs", environments: ["production", "staging"]};
const actorId = "alice";
const clock = () => new Date("2026-10-07T12:00:00.000Z");

function digestOf(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

function must<T>(result: DeploymentResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.error}`);
  return result.value;
}

function deployIndex(store: InMemoryDeploymentStore, environment: Environment, html: string, commit = "c") {
  return store.deploy(docs, environment, {commit, files: {"index.html": html}, actorId});
}

test("one live deployment per environment, and a new deploy supersedes the previous", async () => {
  const store = new InMemoryDeploymentStore({clock});
  const first = must(await deployIndex(store, "production", "v1", "c1"));
  const second = must(await deployIndex(store, "production", "v2", "c2"));

  expect(store.deployments(docs, "production").map((deployment) => deployment.status)).toEqual(["superseded", "live"]);
  expect(store.live(docs, "production")?.id).toBe(second.id);
  expect(second.sequence).toBeGreaterThan(first.sequence);
  expect(second.createdAt).toBe("2026-10-07T12:00:00.000Z");
  expect(second.manifest).toEqual({"index.html": digestOf("v2")});
  expect(await store.deploy(docs, "production", {commit: "c0", files: {}, actorId})).toMatchObject({ok: false, code: "invalid-input"});
});

test("each file is recorded under its SHA-256 digest and the manifest digest tracks content", async () => {
  const store = new InMemoryDeploymentStore({clock});
  const original = must(await store.deploy(docs, "production", {commit: "c1", files: {"hello.txt": "hello"}, actorId}));
  expect(original.manifest["hello.txt"]).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");

  const repeat = must(await store.deploy(docs, "production", {commit: "c2", files: {"hello.txt": "hello"}, actorId}));
  expect(repeat.manifestDigest).toBe(original.manifestDigest);
  const changed = must(await store.deploy(docs, "production", {commit: "c3", files: {"hello.txt": "hello!"}, actorId}));
  expect(changed.manifestDigest).not.toBe(original.manifestDigest);
});

test("rollback restores the previous deployment and marks the current one rolled back", async () => {
  const store = new InMemoryDeploymentStore({clock});
  const v1 = must(await deployIndex(store, "production", "v1"));
  must(await deployIndex(store, "production", "v2"));

  const restored = must(store.rollback(docs, "production", "bob"));
  expect(restored.id).toBe(v1.id);
  expect(store.deployments(docs, "production").map((deployment) => deployment.status)).toEqual(["live", "rolled_back"]);
  expect(must(await store.serve(docs, "production", "index.html")).content).toBe("v1");
  expect(store.history(docs, "production").at(-1)).toMatchObject({action: "rollback", actorId: "bob", deploymentId: v1.id});

  // A later deploy supersedes the restored version, and the rolled-back deployment stays rolled back.
  must(await deployIndex(store, "production", "v3"));
  expect(store.deployments(docs, "production").map((deployment) => deployment.status)).toEqual(["superseded", "rolled_back", "live"]);
  expect(store.live(docs, "production")?.manifest).toEqual({"index.html": digestOf("v3")});
});

test("rollback is refused when there is no earlier deployment to restore", async () => {
  const store = new InMemoryDeploymentStore({clock});
  expect(store.rollback(docs, "production", "bob")).toMatchObject({ok: false, code: "not-deployed"});

  const only = must(await deployIndex(store, "production", "v1"));
  expect(store.rollback(docs, "production", "bob")).toMatchObject({ok: false, code: "no-previous-deployment"});
  expect(store.live(docs, "production")?.id).toBe(only.id);

  // After one rollback there is nothing older left to restore.
  must(await deployIndex(store, "production", "v2"));
  must(store.rollback(docs, "production", "bob"));
  expect(store.rollback(docs, "production", "bob")).toMatchObject({ok: false, code: "no-previous-deployment"});
  expect(store.live(docs, "production")?.id).toBe(only.id);
});

test("paths that escape the site root or are not canonical are refused and change nothing", async () => {
  const store = new InMemoryDeploymentStore({clock});
  const refused = ["../secrets.env", "assets/../../secrets.env", "/etc/passwd", "a/./b.html", "a//b.html", "a\\..\\b.html", ".."];
  for (const path of refused) {
    expect(await store.deploy(docs, "production", {commit: "c1", files: {[path]: "x"}, actorId})).toMatchObject({ok: false, code: "invalid-path"});
  }
  expect(await store.deploy(docs, "production", {commit: "c1", files: {"index.html": "ok", "../x": "bad"}, actorId})).toMatchObject({
    ok: false,
    code: "invalid-path",
  });
  expect(store.deployments(docs, "production")).toEqual([]);

  // A dot inside a name is fine; only a whole '..' segment escapes.
  must(await store.deploy(docs, "production", {commit: "c2", files: {"index.html": "home", "notes..txt": "notes"}, actorId}));
  expect(await store.serve(docs, "production", "../index.html")).toMatchObject({ok: false, code: "invalid-path"});
  expect(await store.serve(docs, "production", "/index.html")).toMatchObject({ok: false, code: "invalid-path"});
  expect(must(await store.serve(docs, "production", "notes..txt")).content).toBe("notes");
});

test("a deployment over 10 MB is refused, counting UTF-8 bytes", async () => {
  const store = new InMemoryDeploymentStore({clock});
  const half = MAX_SITE_BYTES / 2;
  expect(await store.deploy(docs, "staging", {commit: "c1", files: {"big.bin": "x".repeat(MAX_SITE_BYTES)}, actorId})).toMatchObject({ok: true});
  expect(
    await store.deploy(docs, "staging", {commit: "c2", files: {"a.txt": "x".repeat(half), "b.txt": "x".repeat(half + 1)}, actorId}),
  ).toMatchObject({ok: false, code: "too-large"});
  // 5,242,881 characters, but 10,485,762 bytes once UTF-8 encoded.
  expect(await store.deploy(docs, "staging", {commit: "c3", files: {"accents.txt": "é".repeat(half + 1)}, actorId})).toMatchObject({
    ok: false,
    code: "too-large",
  });
  expect(store.deployments(docs, "staging").map((deployment) => deployment.commit)).toEqual(["c1"]);
});

test("serve refuses a stored file whose bytes no longer match the manifest digest", async () => {
  const blobs = new Map<string, string>();
  const store = new InMemoryDeploymentStore({clock, blobs});
  must(await store.deploy(docs, "production", {commit: "c1", files: {"index.html": "<h1>real</h1>", "app.js": "run()"}, actorId}));
  expect(must(await store.serve(docs, "production", "index.html")).content).toBe("<h1>real</h1>");

  blobs.set(digestOf("<h1>real</h1>"), "<h1>owned</h1>");
  expect(await store.serve(docs, "production", "index.html")).toMatchObject({ok: false, code: "integrity-failure"});
  expect(must(await store.serve(docs, "production", "app.js")).content).toBe("run()");

  blobs.delete(digestOf("run()"));
  expect(await store.serve(docs, "production", "app.js")).toMatchObject({ok: false, code: "integrity-failure"});
});

test("serve only returns paths in the live manifest, including prototype names", async () => {
  const store = new InMemoryDeploymentStore({clock});
  must(await deployIndex(store, "production", "home"));
  expect(await store.serve(docs, "production", "missing.html")).toMatchObject({ok: false, code: "not-found"});
  expect(await store.serve(docs, "production", "constructor")).toMatchObject({ok: false, code: "not-found"});
  expect(await store.serve(docs, "production", "toString")).toMatchObject({ok: false, code: "not-found"});
});

test("production and staging are independent", async () => {
  const store = new InMemoryDeploymentStore({clock});
  const prod = must(await deployIndex(store, "production", "prod-1", "p1"));
  expect(await store.serve(docs, "staging", "index.html")).toMatchObject({ok: false, code: "not-deployed"});

  must(await deployIndex(store, "staging", "stage-1", "s1"));
  must(await deployIndex(store, "staging", "stage-2", "s2"));
  must(store.rollback(docs, "staging", "bob"));

  expect(store.live(docs, "production")?.id).toBe(prod.id);
  expect(store.deployments(docs, "production").map((deployment) => deployment.status)).toEqual(["live"]);
  expect(must(await store.serve(docs, "staging", "index.html")).content).toBe("stage-1");
  expect(must(await store.serve(docs, "production", "index.html")).content).toBe("prod-1");

  // Production has no earlier deployment, so its rollback is refused even though staging has history.
  expect(store.rollback(docs, "production", "bob")).toMatchObject({ok: false, code: "no-previous-deployment"});

  // A site that only declares production cannot deploy to staging.
  const productionOnly: Site = {name: "docs", environments: ["production"]};
  expect(await store.deploy(productionOnly, "staging", {commit: "s3", files: {"index.html": "x"}, actorId})).toMatchObject({
    ok: false,
    code: "invalid-input",
  });
});

test("deployments are never deleted and returned records are frozen", async () => {
  const store = new InMemoryDeploymentStore({clock});
  must(await deployIndex(store, "production", "v1", "c1"));
  must(await deployIndex(store, "production", "v2", "c2"));
  must(store.rollback(docs, "production", "bob"));
  must(await deployIndex(store, "production", "v3", "c3"));

  const records = store.deployments(docs, "production");
  expect(records.map((deployment) => deployment.commit)).toEqual(["c1", "c2", "c3"]);
  expect(store.history(docs, "production").map((event) => event.action)).toEqual(["deploy", "deploy", "rollback", "deploy"]);
  const [first] = records;
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first?.manifest)).toBe(true);
});
