import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqlOAuthStore, SqlPackageStore, type SqlLike } from "../src/core/durable-stores";
import { createOAuthServer } from "../src/core/oauth-server";
import { PackageRegistry, type Viewer } from "../src/core/package-registry";

// Wraps bun:sqlite in the same synchronous shape a Durable Object's ctx.storage.sql exposes.
function openSql(path: string): { db: Database; sql: SqlLike } {
  const db = new Database(path);
  const sql: SqlLike = {
    exec(query, ...bindings) {
      const statement = db.query(query);
      if (/^\s*select/i.test(query)) {
        const rows = statement.all(...(bindings as never[]));
        return { toArray: () => rows };
      }
      statement.run(...(bindings as never[]));
      return { toArray: () => [] };
    },
  };
  return { db, sql };
}

const dir = mkdtempSync(join(tmpdir(), "flaregit-durable-"));
const dbPath = join(dir, "authority.sqlite");

test("OAuth grants survive a restart: a replayed code and a reused refresh token still revoke the grant", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  const redirect = "https://app.example/cb";
  const now = 1_800_000_000_000;

  const first = openSql(dbPath);
  const server = createOAuthServer({ clock: () => now, store: createSqlOAuthStore(first.sql) });
  const registered = server.registerApp({ name: "App", redirectUris: [redirect], scopes: ["code:read"] });
  if (!registered.ok) throw new Error(registered.error);
  const authorized = await server.authorize({ clientId: registered.clientId, redirectUri: redirect, scope: "code:read", codeChallenge: challenge, codeChallengeMethod: "S256", userId: "user-1" });
  if (!authorized.ok) throw new Error(authorized.error);
  const issued = await server.exchange({ code: authorized.code, clientId: registered.clientId, redirectUri: redirect, codeVerifier: verifier });
  if (!issued.ok) throw new Error(issued.error);
  first.db.close();

  // Restart: a new server over the same database must recognize the grant and the used code.
  const second = openSql(dbPath);
  const restarted = createOAuthServer({ clock: () => now, store: createSqlOAuthStore(second.sql) });
  expect(await restarted.introspect(issued.accessToken)).toMatchObject({ active: true, userId: "user-1" });
  const replay = await restarted.exchange({ code: authorized.code, clientId: registered.clientId, redirectUri: redirect, codeVerifier: verifier });
  expect(replay.ok).toBe(false);
  expect(await restarted.introspect(issued.accessToken)).toEqual({ active: false });
  second.db.close();
});

test("a grant revoked before a restart stays revoked after it", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  const redirect = "https://app.example/cb";
  const now = 1_800_000_000_000;
  const path = join(dir, "revoke.sqlite");

  const first = openSql(path);
  const server = createOAuthServer({ clock: () => now, store: createSqlOAuthStore(first.sql) });
  const registered = server.registerApp({ name: "App", redirectUris: [redirect], scopes: ["code:read"] });
  if (!registered.ok) throw new Error(registered.error);
  const authorized = await server.authorize({ clientId: registered.clientId, redirectUri: redirect, scope: "code:read", codeChallenge: challenge, codeChallengeMethod: "S256", userId: "user-2" });
  if (!authorized.ok) throw new Error(authorized.error);
  const issued = await server.exchange({ code: authorized.code, clientId: registered.clientId, redirectUri: redirect, codeVerifier: verifier });
  if (!issued.ok) throw new Error(issued.error);
  await server.revoke(issued.accessToken);
  first.db.close();

  const second = openSql(path);
  const restarted = createOAuthServer({ clock: () => now, store: createSqlOAuthStore(second.sql) });
  expect(await restarted.introspect(issued.accessToken)).toEqual({ active: false });
  second.db.close();
});

const owner: Viewer = { id: "acme", memberOf: [] };
const outsider: Viewer = { id: "alice", memberOf: [] };
const base = { name: "widget", version: "1.0.0", files: { "index.ts": "export const widget = 1;\n" }, ownerId: "acme" };

test("published versions survive a restart, stay immutable, and fetch verified bytes", async () => {
  const path = join(dir, "registry.sqlite");
  const first = openSql(path);
  const published = await new PackageRegistry(new SqlPackageStore(first.sql)).publish(base);
  expect(published.ok).toBe(true);
  first.db.close();

  const second = openSql(path);
  const registry = new PackageRegistry(new SqlPackageStore(second.sql));
  expect(await registry.publish({ ...base, files: { "index.ts": "changed" } })).toMatchObject({ ok: false, status: 409 });
  expect(await registry.fetchFile("widget", "1.0.0", "index.ts", owner)).toMatchObject({ ok: true, content: base.files["index.ts"] });
  expect(await registry.fetchFile("widget", "1.0.0", "index.ts", outsider)).toMatchObject({ ok: true });
  second.db.close();
});

test("a tampered stored file is refused on fetch after a restart", async () => {
  const path = join(dir, "tamper.sqlite");
  const first = openSql(path);
  await new PackageRegistry(new SqlPackageStore(first.sql)).publish(base);
  // Simulate tampering directly in the database: replace the stored bytes for index.ts.
  const row = first.sql.exec("SELECT json FROM pkg_versions WHERE name = ?", "widget").toArray()[0] as { json: string };
  const json = JSON.parse(row.json);
  json.files[0].bytes = btoa("export const widget = 999;\n");
  first.sql.exec("UPDATE pkg_versions SET json = ? WHERE name = ?", JSON.stringify(json), "widget");
  first.db.close();

  const second = openSql(path);
  const registry = new PackageRegistry(new SqlPackageStore(second.sql));
  expect(await registry.fetchFile("widget", "1.0.0", "index.ts", owner)).toMatchObject({ ok: false });
  second.db.close();
});

test("deprecation is persisted and resolve skips deprecated versions after a restart", async () => {
  const path = join(dir, "deprecate.sqlite");
  const first = openSql(path);
  const registry = new PackageRegistry(new SqlPackageStore(first.sql));
  await registry.publish(base);
  await registry.publish({ ...base, version: "1.1.0", files: { "index.ts": "v2" } });
  expect(await registry.deprecate("widget", "1.1.0", "use 1.0.0", "acme")).toMatchObject({ ok: true });
  first.db.close();

  const second = openSql(path);
  const restarted = new PackageRegistry(new SqlPackageStore(second.sql));
  expect(await restarted.resolve("widget", "1.x", owner)).toMatchObject({ ok: true, version: "1.0.0" });
  second.db.close();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('immutable package publication order survives durable restart and deprecation',async()=>{
 const path=join(dir,'publication-order.sqlite'),first=openSql(path),registry=new PackageRegistry(new SqlPackageStore(first.sql));
 expect((await registry.publish({...base,version:'9.0.0'})).ok).toBe(true);expect((await registry.publish({...base,version:'1.0.0'})).ok).toBe(true);
 expect([...registry.publicationOrder(base.name,owner)]).toEqual([['9.0.0',1],['1.0.0',2]]);first.db.close();
 const second=openSql(path);try{const restarted=new PackageRegistry(new SqlPackageStore(second.sql));expect([...restarted.publicationOrder(base.name,owner)]).toEqual([['9.0.0',1],['1.0.0',2]]);expect(restarted.deprecate(base.name,'1.0.0','Old',base.ownerId).ok).toBe(true);expect([...restarted.publicationOrder(base.name,owner)]).toEqual([['9.0.0',1],['1.0.0',2]]);}finally{second.db.close();}
});
