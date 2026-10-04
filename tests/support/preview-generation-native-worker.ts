import { RepositoryController } from "../../src/server/durable-object";
import { RepositoryPreviewGenerations } from "../../src/server/preview-generations";
import { createPreviewStorageManifest } from "../../src/server/preview-storage-upload";
import { generationBuildPrefix, signPreview, signPreviewGeneration } from "../../src/server/preview-access";
import { handlePreviewAsset } from "../../src/server/preview-broker";
import type { Env } from "../../src/server/env";
const identity = { projectId: "p123456789abc", incarnation: "12345678-1234-1234-1234-123456789abc", commit: "a".repeat(40), accountKey: "abcdef123456" };
const source = `builds/${identity.projectId}/${identity.commit}`;
const origin = "https://repo.account.workers.dev";
const writer = "abcdef12-1234-1234-1234-123456789abc";
const bytes = new TextEncoder().encode("old preview");
async function digest(value: Uint8Array) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(value))), b => b.toString(16).padStart(2, "0")).join(""); }
export class GenerationNativeFixture extends RepositoryController {
  constructor(ctx: DurableObjectState, env: Env) {
    // Synthetic provider refusal only: no remote accounts or credentials are contacted.
    const artifacts = { get: async () => ({ revokeToken: async () => { ctx.storage.sql.exec("INSERT INTO fixture_revocations DEFAULT VALUES"); return false; }, [Symbol.dispose]() {} }) };
    super(ctx, { ...env, ARTIFACTS: artifacts } as unknown as Env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS fixture_revocations(id INTEGER PRIMARY KEY)");
  }
  async fixtureAlarm() { await this.ctx.storage.deleteAlarm(); await super.alarm(); return { alarm: await this.ctx.storage.getAlarm(), attempts: this.ctx.storage.sql.exec<{ attempts: number; status: string; erased: number }>("SELECT attempts,status,token IS NULL AS erased FROM preview_credential_incidents").toArray(), providerCalls: this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM fixture_revocations").one().count }; }
  fixtureExpireCredentials() { this.ctx.storage.sql.exec("UPDATE preview_credential_incidents SET expires_at=? WHERE status='pending'", Date.now()-1); }

  fixtureBegin(expected: string | null, idempotency: string) { return new RepositoryPreviewGenerations(this.ctx.storage).begin(identity, "fixture-owner", expected, idempotency); }
  fixtureClaim(g: string) { return new RepositoryPreviewGenerations(this.ctx.storage).markBuilding(g); }
  fixturePromote(g: string, hash: string) { return new RepositoryPreviewGenerations(this.ctx.storage).promote(g, identity, hash); }
  fixtureRead(commit: string, incarnation: string, g: string) { const record = new RepositoryPreviewGenerations(this.ctx.storage).get(g); return !this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='fixture_deleted'").toArray().length && record?.state === "ready" && record.identity.commit === commit && record.identity.incarnation === incarnation; }
  fixtureDelete() { this.ctx.storage.sql.exec("CREATE TABLE fixture_deleted(id INTEGER)"); }
  fixtureSnapshot() { return { reservations: this.ctx.storage.sql.exec("SELECT physical_key,bytes FROM preview_storage_reservations ORDER BY physical_key").toArray(), writers: this.ctx.storage.sql.exec("SELECT physical_key,closed,pending FROM preview_copy_writers ORDER BY physical_key").toArray() }; }
}
export default { async fetch(request: Request, env: Env) {
  const url = new URL(request.url), global = env.REPOSITORY_CONTROLLER.getByName("global") as unknown as GenerationNativeFixture;
  const repository = env.REPOSITORY_CONTROLLER.getByName(`project:${identity.projectId}`) as unknown as GenerationNativeFixture;
  try {
    if (url.pathname === "/start") {
      const manifest = await createPreviewStorageManifest(identity, [{ path: "index.html", size: bytes.length, sha256: await digest(bytes) }]);
      const admission = await global.reservePreviewStorage(manifest); if (!admission.allowed) throw new Error(admission.reason);
      await global.reservePreviewWriter(source, writer); await global.beginPreviewPut(source, writer, "index.html");
      // The dispatch receipt remains pending. No storage success or failure is inferred.
      await global.quarantinePreviewStorage(source, identity);
      return Response.json({ source, identity });
    }
    if (url.pathname === "/begin") return Response.json(await repository.fixtureBegin(url.searchParams.get("expected"), url.searchParams.get("key")!));
    if (url.pathname === "/claim") return Response.json(await repository.fixtureClaim(url.searchParams.get("g")!));
    if (url.pathname === "/publish") {
      const g = url.searchParams.get("g")!, nextBytes = new TextEncoder().encode("new preview"), scoped = { ...identity, generation: g };
      const estimate = await global.previewGenerationEstimate(source, identity, g);
      const admitted = await global.reservePreviewGenerationEstimate(estimate); if (!admitted.allowed) throw new Error(admitted.reason);
      const manifest = await createPreviewStorageManifest(scoped, [{ path: "index.html", size: nextBytes.length, sha256: await digest(nextBytes) }]);
      const finalized = await global.finalizePreviewGenerationManifest(manifest); if (!finalized.allowed) throw new Error(finalized.reason);
      const prefix = generationBuildPrefix(identity.projectId, identity.commit, identity.incarnation, g), nextWriter = crypto.randomUUID();
      await global.reservePreviewWriter(prefix, nextWriter); await global.beginPreviewPut(prefix, nextWriter, "index.html");
      await env.EVIDENCE_BUCKET.put(`${prefix}/index.html`, nextBytes, { onlyIf: { etagDoesNotMatch: "*" }, customMetadata: { sha256: manifest.assets[0]!.sha256, manifestHash: manifest.manifestHash } });
      await global.finishPreviewPut(prefix, nextWriter, "index.html"); await global.finishPreviewWriter(prefix, nextWriter);
      await repository.fixturePromote(g, manifest.manifestHash); return new Response("ok");
    }
    if (url.pathname === "/snapshot") return Response.json(await global.fixtureSnapshot());
    if (url.pathname === "/late-old-put") { await env.EVIDENCE_BUCKET.put(`${source}/index.html`, bytes, { onlyIf: { etagDoesNotMatch: "*" } }); return new Response("ok"); }
    if (url.pathname === "/delete-scope") { await repository.fixtureDelete(); return new Response("ok"); }
    if (url.pathname === "/credential-start") {
      await repository.initialize({ projectId: identity.projectId, projectName: "Native credential fixture", canonicalRepoName: `flaregit-${identity.projectId}`, head: identity.commit, verificationPolicy: {} });
      await repository.previewGenerationCredentialIncident(url.searchParams.get("g")!, url.searchParams.get("repo") ?? `flaregit-${identity.projectId}`, "synthetic-fixture-secret", Date.now()+600000);
      return new Response("ok");
    }
    if (url.pathname === "/credential-summary") return Response.json(await repository.previewGenerationCredentialSummary(url.searchParams.get("g")!));
    if (url.pathname === "/credential-alarm") return Response.json(await repository.fixtureAlarm());
    if (url.pathname === "/credential-expire") { await repository.fixtureExpireCredentials(); return new Response("ok"); }
    if (url.pathname === "/links") {
      const g = url.searchParams.get("g")!;
      const current = await signPreviewGeneration(env, identity.projectId, identity.commit, identity.incarnation, g, origin), old = await signPreview(env, identity.projectId, identity.commit, origin);
      return Response.json({ generation: `${origin}/preview-v3/${identity.commit}/${identity.incarnation}/${g}/${current.exp}/${current.sig}/`, legacy: `${origin}/preview/${identity.commit}/${old.exp}/${old.sig}/` });
    }
    if (url.pathname === "/asset") {
      // This adapter deliberately tests the production broker against the pure SQLite generation state;
      // authorization lifecycle integration remains a separate RepositoryController gate.
      const adapter = { ...env, REPOSITORY_CONTROLLER: { idFromName: (name: string) => name, get: (id: string) => id === "global" ? { activePreviewOrigin: async () => origin } : { previewGenerationForRead: (commit: string, inc: string, g: string) => repository.fixtureRead(commit, inc, g), previewAvailable: async () => true, previewLegacyGenerationAllowed: async () => false } } } as unknown as Env;
      return handlePreviewAsset(new Request(url.searchParams.get("url")!), adapter, identity.projectId);
    }
    return new Response("missing", { status: 404 });
  } catch (error) { return new Response(error instanceof Error ? error.message : "failure", { status: 409 }); }
} };
