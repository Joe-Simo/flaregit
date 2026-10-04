import { orderedPreviewAssets } from "./preview-assets.js";
import { MAX_FILE_BYTES } from "./file-bytes.js";
export const MAX_PREVIEW_ASSETS = 1000;
export const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;
export interface PreviewStorageIdentity { generation?:string; projectId: string; incarnation: string; commit: string; accountKey: string }
export interface PreviewStorageAsset { path: string; size: number; sha256: string }
export interface PreviewStorageManifest { version: 1; identity: PreviewStorageIdentity; assets: PreviewStorageAsset[]; totalBytes: number; manifestHash: string }
interface Inspector { exec(argv: string[]): Promise<{ success: boolean; stdout: string }> }
const ROOT = "/tmp/build-out";
const INSPECT_SCRIPT = `import {lstat,readdir} from "node:fs/promises";
const root="/tmp/build-out",assets=[];let total=0,entries=0;
async function walk(dir,rel="") {
 const stat=await lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error("Invalid preview directory");
 for(const name of await readdir(dir)) {
  if(++entries>8192)throw Error("Preview tree too large");
  const path=rel?rel+"/"+name:name;
  if(/[\\\\\\x00-\\x1f\\x7f]/.test(path))throw Error("Invalid asset path");
  const absolute=root+"/"+path,s=await lstat(absolute);
  if(s.isSymbolicLink())throw Error("Preview symlink rejected");
  if(s.isDirectory()){await walk(absolute,path);continue;}
  if(!s.isFile()||s.size>${MAX_FILE_BYTES}||assets.length>=${MAX_PREVIEW_ASSETS})throw Error("Invalid preview asset");
  total+=s.size;if(total>${MAX_PREVIEW_BYTES})throw Error("Preview too large");
  const bytes=await Bun.file(absolute).arrayBuffer();if(bytes.byteLength!==s.size)throw Error("Preview changed");
  const hash=new Bun.CryptoHasher("sha256").update(bytes).digest("hex");assets.push({path,size:s.size,sha256:hash});
 }
}
await walk(root);console.log(JSON.stringify(assets));`;
async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function createPreviewStorageManifest(identity: PreviewStorageIdentity, input: readonly PreviewStorageAsset[]): Promise<PreviewStorageManifest> {
  if ([identity.projectId, identity.incarnation, identity.commit, identity.accountKey].some((value) => typeof value !== "string" || !value || /[\x00-\x1f\x7f]/.test(value))) throw new Error("Invalid preview identity");
  if (!input.length || input.length > MAX_PREVIEW_ASSETS || input.some((asset) => typeof asset.path !== "string" || /[\x00-\x1f\x7f]/.test(asset.path))) throw new Error("Invalid preview asset count or path");
  const paths = orderedPreviewAssets(input.map((asset) => asset.path).join("\n"));
  const byPath = new Map(input.map((asset) => [asset.path, asset]));
  let totalBytes = 0;
  const assets = paths.map((path) => {
    const asset = byPath.get(path);
    if (!asset || !Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error("Invalid preview asset metadata");
    totalBytes += asset.size;
    return { path, size: asset.size, sha256: asset.sha256 };
  });
  if (totalBytes > MAX_PREVIEW_BYTES) throw new Error("Preview exceeds storage limit");
  if(identity.generation&&!/^[a-f0-9-]{36}$/.test(identity.generation))throw new Error("Invalid preview generation");
  const trustedIdentity = { ...(identity.generation?{generation:identity.generation}:{}), projectId: identity.projectId, incarnation: identity.incarnation, commit: identity.commit, accountKey: identity.accountKey };
  const payload = { version: 1 as const, identity: trustedIdentity, assets, totalBytes };
  const manifest = { ...payload, manifestHash: await sha256(new TextEncoder().encode(JSON.stringify(payload))) };
  for (const asset of assets) Object.freeze(asset);
  Object.freeze(assets); Object.freeze(trustedIdentity);
  return Object.freeze(manifest);
}
export async function inspectPreviewStorageManifest(sandbox: Inspector, identity: PreviewStorageIdentity): Promise<PreviewStorageManifest> {
  const result = await sandbox.exec(["bun", "-e", INSPECT_SCRIPT]);
  if (!result.success || result.stdout.length > 512 * 1024) throw new Error("Could not inspect preview manifest");
  const parsed: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(parsed) || parsed.some((asset: unknown) => typeof asset !== "object" || asset === null || !("path" in asset) || !("size" in asset) || !("sha256" in asset) || typeof asset.path !== "string" || typeof asset.size !== "number" || typeof asset.sha256 !== "string")) throw new Error("Invalid preview manifest");
  return createPreviewStorageManifest(identity, parsed as PreviewStorageAsset[]);
}
const MIME: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", svg: "image/svg+xml", json: "application/json", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf" };
/** The caller retains the ledger hold on every error, including unknown put outcomes. */
export async function publishPreviewStorageManifest(manifest: PreviewStorageManifest, options: {
  prefix: string;
  reserve(manifest: PreviewStorageManifest): Promise<void>;
  writer: {begin(id:string):Promise<void>;beforePut(id:string,path:string):Promise<void>;settledPut(id:string,path:string):Promise<void>;finish(id:string):Promise<void>};
  authorize(): Promise<void>;
  getFile(path: string): Promise<Uint8Array>;
  bucket: { head(key: string): Promise<{ size: number; customMetadata?: Record<string, string> } | null>; put(key: string, bytes: Uint8Array, options: { httpMetadata: { contentType: string }; customMetadata: { sha256: string; manifestHash: string }; onlyIf: { etagDoesNotMatch: string } }): Promise<unknown> };
}): Promise<void> {
  const snapshot = await createPreviewStorageManifest(manifest.identity, manifest.assets);
  if (snapshot.manifestHash !== manifest.manifestHash || snapshot.totalBytes !== manifest.totalBytes) throw new Error("Preview manifest changed");
  await options.reserve(snapshot);
  const writerId=crypto.randomUUID();
  await options.writer.begin(writerId);
  let pending=false;
  try {
  for (const asset of snapshot.assets) {
    await options.authorize();
    const key = `${options.prefix}/${asset.path}`;
    const existing = await options.bucket.head(key);
    if (existing) {
      if (existing.size !== asset.size || existing.customMetadata?.sha256 !== asset.sha256 || existing.customMetadata?.manifestHash !== snapshot.manifestHash) throw new Error("Existing preview asset conflicts with manifest");
      await options.authorize();
      continue;
    }
    const bytes = await options.getFile(`${ROOT}/${asset.path}`);
    if (bytes.byteLength !== asset.size || await sha256(bytes) !== asset.sha256) throw new Error("Preview asset changed before upload");
    await options.authorize();
    await options.writer.beforePut(writerId,asset.path);
    pending=true;
    const uploaded = await options.bucket.put(key, bytes, { httpMetadata: { contentType: MIME[asset.path.split(".").pop() ?? ""] ?? "application/octet-stream" }, customMetadata: { sha256: asset.sha256, manifestHash: snapshot.manifestHash }, onlyIf: { etagDoesNotMatch: "*" } });
    if (!uploaded) throw new Error("Preview upload outcome unconfirmed or conflicted");
    if (bytes.byteLength !== asset.size || await sha256(bytes) !== asset.sha256) throw new Error("Preview asset changed during upload");
    await options.writer.settledPut(writerId,asset.path);
    pending=false;
    await options.authorize();
  }
  }finally{if(!pending)await options.writer.finish(writerId);}
}

export async function validatePreviewStorageManifest(manifest: PreviewStorageManifest): Promise<void> {
  const snapshot = await createPreviewStorageManifest(manifest.identity, manifest.assets);
  if (manifest.version !== 1 || snapshot.manifestHash !== manifest.manifestHash || snapshot.totalBytes !== manifest.totalBytes) throw new Error("Preview manifest changed");
}
