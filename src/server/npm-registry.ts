/** npm publish/packument/tarball protocol over immutable durable package versions.
 * Protocol references: https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md
 * https://docs.npmjs.com/cli/commands/npm-publish/ */
import { MAX_PACKAGE_BYTES, type PackageRegistry, type Viewer } from "../core/package-registry";

export interface NpmRegistryCall {
  readonly method: string;
  /** Full URL. The registry is mounted at /npm/. */
  readonly url: string;
  readonly body: unknown;
  /** Verified identity and namespaces from the HTTP authentication layer. */
  readonly userId?: string;
  readonly namespaces?: readonly string[];
  readonly memberOf?: readonly string[];
  readonly canPublish?: boolean;
}
export interface NpmRegistryReply {
  readonly status: number;
  readonly contentType: string;
  readonly body: string | Uint8Array<ArrayBuffer>;
}
const object = (value: unknown): Record<string, unknown> | undefined => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const json = (status: number, body: unknown): NpmRegistryReply => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const failure = (status: number, error: string) => json(status, { error });
const base64 = (bytes: Uint8Array<ArrayBuffer>): string => {
  let output = "";
  for (const byte of bytes) output += String.fromCharCode(byte);
  return btoa(output);
};
async function digest(bytes: Uint8Array<ArrayBuffer>, algorithm: "SHA-1" | "SHA-512"): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
  return algorithm === "SHA-512" ? `sha512-${base64(hash)}` : Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
}
const TARBALL = "npm/package.tgz";
const MANIFEST = "npm/manifest.json";

export async function handleNpmRegistryCall(registry: PackageRegistry, call: NpmRegistryCall): Promise<NpmRegistryReply> {
  const url = new URL(call.url);
  const viewer: Viewer = { id: call.userId, memberOf: call.memberOf ?? [] };
  const pathname = url.pathname.slice("/npm/".length);
  if (pathname === "-/ping") return json(200, {});
  if (pathname === "-/whoami") return call.userId ? json(200, { username: call.userId }) : failure(401, "Authentication required");
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return failure(400, "Invalid URL encoding"); }
  const tarballMatch = /^(.*?)\/-\/([^/]+)\.tgz$/.exec(decoded);
  const name = tarballMatch?.[1] ?? decoded;
  if (tarballMatch) {
    if (call.method !== "GET") return failure(405, "Method not allowed");
    // Tarball URLs carry only a version, avoiding ambiguous package-name parsing.
    const version = tarballMatch[2]!;
    const bytes = await registry.fetchBytes(name, version, TARBALL, viewer);
    return bytes.ok ? { status: 200, contentType: "application/octet-stream", body: bytes.bytes } : failure(bytes.status, bytes.error);
  }
  if (call.method === "PUT") {
    if (!call.userId) return failure(401, "Authentication required");
    if (!call.canPublish) return failure(403, "Package publishing permission required");
    if (name.startsWith("@") && !(call.namespaces ?? []).includes(name.slice(1).split("/")[0]!)) return failure(403, "Package scope is outside your namespaces");
    const input = object(call.body);
    const versions = object(input?.versions);
    const attachments = object(input?._attachments);
    const entries = Object.entries(versions ?? {});
    if (!input || input.name !== name || entries.length !== 1 || !attachments) return failure(400, "Publish one named package version and tarball attachment");
    const [version, rawManifest] = entries[0]!;
    const manifest = object(rawManifest);
    const attachmentEntries = Object.entries(attachments);
    if (!manifest || manifest.name !== name || manifest.version !== version || attachmentEntries.length !== 1) return failure(400, "Package manifest does not match publish path/version");
    const attachment = object(attachmentEntries[0]![1]);
    if (!attachment || typeof attachment.data !== "string" || !Number.isSafeInteger(attachment.length) || typeof attachment.length !== "number" || attachment.length < 1 || attachment.length > MAX_PACKAGE_BYTES) return failure(400, "Invalid tarball attachment");
    if (attachment.data.length > Math.ceil(MAX_PACKAGE_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(attachment.data)) return failure(400, "Invalid tarball encoding");
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = Uint8Array.from(atob(attachment.data), character => character.charCodeAt(0)); } catch { return failure(400, "Invalid tarball encoding"); }
    if (bytes.length !== attachment.length) return failure(400, "Tarball attachment length mismatch");
    const dist = object(manifest.dist);
    const integrity = await digest(bytes, "SHA-512");
    const shasum = await digest(bytes, "SHA-1");
    if (!dist || dist.integrity !== integrity || dist.shasum !== shasum) return failure(400, "Tarball digest mismatch");
    if (input.access !== undefined && input.access !== "public" && input.access !== "restricted") return failure(400, "Invalid package access");
    const tags = object(input["dist-tags"]);
    if (!tags || Object.values(tags).some(value => value !== version)) return failure(400, "Dist tags must identify the published version");
    const prior = registry.metadata(name, viewer);
    const publication = prior.ok ? prior.metadata.versions.length + 1 : 1;
    const published = await registry.publishBinary({ name, version, ownerId: call.userId, private: input.access === "restricted", files: {
      [TARBALL]: bytes,
      [MANIFEST]: new TextEncoder().encode(JSON.stringify({ manifest: { ...manifest, dist: { integrity, shasum } }, tags, publication })),
    } });
    return published.ok ? json(201, { ok: true, id: name, rev: version }) : failure(published.status, published.error);
  }
  if (call.method !== "GET") return failure(405, "Method not allowed");
  const metadata = registry.metadata(name, viewer);
  if (!metadata.ok) return failure(metadata.status, metadata.error);
  const versions: Record<string, unknown> = {};
  const tags: Record<string, string> = {};
  const tagPublications: { publication: number; tags: Record<string, unknown> }[] = [];
  // Package versions keep semver order; tag updates follow publication order.
  for (const version of [...metadata.metadata.versions].reverse()) {
    const stored = await registry.fetchFile(name, version.version, MANIFEST, viewer);
    if (!stored.ok) { if (stored.status === 404) continue; return failure(stored.status, stored.error); }
    const document = object(JSON.parse(stored.content));
    const manifest = object(document?.manifest);
    if (!manifest) return failure(500, "Stored npm manifest is invalid");
    const storedTags = object(document?.tags);
    tagPublications.push({ publication: typeof document?.publication === "number" ? document.publication : 0, tags: storedTags ?? {} });
    versions[version.version] = { ...manifest, ...(version.deprecated ? { deprecated: version.deprecated } : {}), dist: { ...object(manifest.dist), tarball: `${url.origin}/npm/${encodeURIComponent(name)}/-/${version.version}.tgz` } };
  }
  for (const item of tagPublications.sort((left, right) => left.publication - right.publication)) {
    for (const [tag, target] of Object.entries(item.tags)) if (typeof target === "string") tags[tag] = target;
  }
  if (!Object.keys(versions).length) return failure(404, "No npm versions found");
  return json(200, { name, "dist-tags": tags, versions });
}
