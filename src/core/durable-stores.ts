/** Durable stores for the OAuth server and package registry, backed by any synchronous SQL object (a Durable Object's `ctx.storage.sql` or bun:sqlite). Values are stored as JSON; bytes are base64. */
import type {KeyValue, OAuthStore, AppRecord, CodeRecord, GrantRecord, AccessTokenRecord, RefreshTokenRecord} from "./oauth-server";
import {PackageCapacityError, type PackageStore, type StoredFile, type StoredVersion} from "./package-registry";

export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): {toArray(): unknown[]};
}

export function ensureSchema(sql: SqlLike): void {
  sql.exec("CREATE TABLE IF NOT EXISTS kv(ns TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY(ns, k))");
  sql.exec("CREATE TABLE IF NOT EXISTS pkg_versions(name TEXT NOT NULL, version TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(name, version))");
}

export class SqlKeyValue<V> implements KeyValue<V> {
  constructor(
    private readonly sql: SqlLike,
    private readonly namespace: string,
  ) {}

  get(key: string): V | undefined {
    const row = this.sql.exec("SELECT v FROM kv WHERE ns = ? AND k = ?", this.namespace, key).toArray()[0] as {v: string} | undefined;
    return row === undefined ? undefined : (JSON.parse(row.v) as V);
  }

  values(): V[] {
    const rows = this.sql.exec("SELECT v FROM kv WHERE ns = ? LIMIT 10001", this.namespace).toArray() as {v:string}[];
    if (rows.length > 10000) throw Error("OAuth catalog capacity exceeded");
    return rows.map(row => JSON.parse(row.v) as V);
  }

  set(key: string, value: V): void {
    this.sql.exec("INSERT OR REPLACE INTO kv(ns, k, v) VALUES(?, ?, ?)", this.namespace, key, JSON.stringify(value));
  }
}

export function createSqlOAuthStore(sql: SqlLike): OAuthStore {
  ensureSchema(sql);
  return {
    apps: new SqlKeyValue<AppRecord>(sql, "apps"),
    codes: new SqlKeyValue<CodeRecord>(sql, "codes"),
    grants: new SqlKeyValue<GrantRecord>(sql, "grants"),
    accessTokens: new SqlKeyValue<AccessTokenRecord>(sql, "accessTokens"),
    refreshTokens: new SqlKeyValue<RefreshTokenRecord>(sql, "refreshTokens"),
  };
}

interface StoredFileJson {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly bytes: string;
}

interface StoredVersionJson {
  readonly name: string;
  readonly version: string;
  readonly ownerId: string;
  readonly private: boolean;
  readonly files: StoredFileJson[];
  readonly integrity: string;
  readonly deprecated: string | null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeVersion(stored: StoredVersion): string {
  const json: StoredVersionJson = {
    name: stored.name,
    version: stored.version,
    ownerId: stored.ownerId,
    private: stored.private,
    integrity: stored.integrity,
    deprecated: stored.deprecated,
    files: [...stored.files.values()].map((file) => ({path: file.path, sha256: file.sha256, size: file.size, bytes: toBase64(file.bytes)})),
  };
  return JSON.stringify(json);
}

function decodeVersion(text: string): StoredVersion {
  const json = JSON.parse(text) as StoredVersionJson;
  const files = new Map<string, StoredFile>(
    json.files.map((file) => [file.path, {path: file.path, sha256: file.sha256, size: file.size, bytes: fromBase64(file.bytes)}]),
  );
  return {
    name: json.name,
    version: json.version,
    ownerId: json.ownerId,
    private: json.private,
    integrity: json.integrity,
    deprecated: json.deprecated,
    files,
  };
}

/** Immutable versions: a stored version is never replaced, and only its deprecation message changes. */
export class SqlPackageStore implements PackageStore {
  constructor(private readonly sql: SqlLike) {
    ensureSchema(sql);
  }

  versionsOf(name: string): StoredVersion[] {
    return this.sql
      .exec("SELECT json FROM pkg_versions WHERE name = ?", name)
      .toArray()
      .map((row) => decodeVersion((row as {json: string}).json));
  }

  getVersion(name: string, version: string): StoredVersion | undefined {
    const row = this.sql.exec("SELECT json FROM pkg_versions WHERE name = ? AND version = ?", name, version).toArray()[0] as {json: string} | undefined;
    return row === undefined ? undefined : decodeVersion(row.json);
  }

  putVersion(stored: StoredVersion): void {
    if (this.getVersion(stored.name, stored.version) !== undefined) throw new Error(`${stored.name}@${stored.version} is already stored`);
    const encoded = encodeVersion(stored);
    const usage = this.sql.exec("SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(json AS BLOB))), 0) AS bytes FROM pkg_versions").toArray()[0] as {count: number; bytes: number};
    if (usage.count >= 9000 || usage.bytes + new TextEncoder().encode(encoded).byteLength > 192 * 1024 * 1024) throw new PackageCapacityError("Package registry capacity reached");
    this.sql.exec("INSERT INTO pkg_versions(name, version, json) VALUES(?, ?, ?)", stored.name, stored.version, encoded);
  }

  setDeprecation(name: string, version: string, message: string): void {
    const stored = this.getVersion(name, version);
    if (stored === undefined) throw new Error(`${name}@${version} is not stored`);
    this.sql.exec("UPDATE pkg_versions SET json = ? WHERE name = ? AND version = ?", encodeVersion({...stored, deprecated: message}), name, version);
  }
}
