const testWriter={begin:async()=>{},beforePut:async()=>{},settledPut:async()=>{},finish:async()=>{}};
import { expect, test } from "bun:test";
import { createPreviewStorageManifest, inspectPreviewStorageManifest, publishPreviewStorageManifest, validatePreviewStorageManifest, MAX_PREVIEW_BYTES } from "../src/server/preview-storage-upload.js";
const identity = { projectId: "project", incarnation: "incarnation", commit: "commit", accountKey: "owner" };
const bytes = new TextEncoder().encode("hello");
const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const asset = (path: string, size = bytes.length) => ({ path, size, sha256: digest });
test("manifest identity, deterministic ordering and readiness signal", async () => {
  const first = await createPreviewStorageManifest(identity, [asset("index.html"), asset("z.js"), asset("a.js")]);
  const second = await createPreviewStorageManifest(identity, [asset("a.js"), asset("index.html"), asset("z.js")]);
  expect(first.manifestHash).toBe(second.manifestHash);
  expect(first.assets.map((item) => item.path)).toEqual(["a.js", "z.js", "index.html"]);
  expect((await createPreviewStorageManifest({ ...identity, accountKey: "other" }, first.assets)).manifestHash).not.toBe(first.manifestHash);
  await validatePreviewStorageManifest(first);
  await expect(validatePreviewStorageManifest({ ...first, totalBytes: 0 })).rejects.toThrow();
});
test("invalid paths, per-file and aggregate bounds fail closed", async () => {
  for (const path of ["../x", "/x", "a\\x", "a\nx", "./index.html"]) {
    await expect(createPreviewStorageManifest(identity, [asset("index.html"), asset(path)])).rejects.toThrow();
  }
  await expect(createPreviewStorageManifest(identity, [asset("index.html", 16 * 1024 * 1024 + 1)])).rejects.toThrow();
  await expect(createPreviewStorageManifest(identity, [asset("index.html", MAX_PREVIEW_BYTES / 4), ...["a", "b", "c", "d"].map((path) => asset(path, MAX_PREVIEW_BYTES / 4))])).rejects.toThrow();
});
test("reservation denial causes no reads or writes", async () => {
  const manifest = await createPreviewStorageManifest(identity, [asset("index.html")]);
  const events: string[] = [];
  await expect(publishPreviewStorageManifest(manifest, { prefix: "builds/project/commit", writer:testWriter,reserve: async () => { events.push("reserve"); throw Error("full"); }, authorize: async () => { events.push("authorize"); }, getFile: async () => { events.push("read"); return bytes; }, bucket: { head: async () => null, put: async () => { events.push("put"); } } })).rejects.toThrow("full");
  expect(events).toEqual(["reserve"]);
});
test("sequential uploads hash each buffer and publish index last", async () => {
  const manifest = await createPreviewStorageManifest(identity, [asset("index.html"), asset("a.js")]);
  const events: string[] = [];
  await publishPreviewStorageManifest(manifest, { prefix: "builds/project/commit", writer:testWriter,reserve: async () => { events.push("reserve"); }, authorize: async () => { events.push("authorize"); }, getFile: async (path) => { events.push(`read:${path}`); return bytes; }, bucket: { head: async () => null, put: async (key, _bytes, options) => { events.push(`put:${key}`); expect(options.customMetadata.sha256).toBe(digest); expect(options.onlyIf).toEqual({ etagDoesNotMatch: "*" }); return {}; } } });
  expect(events).toEqual(["reserve", "authorize", "read:/tmp/build-out/a.js", "authorize", "put:builds/project/commit/a.js", "authorize", "authorize", "read:/tmp/build-out/index.html", "authorize", "put:builds/project/commit/index.html", "authorize"]);
});
test("changed bytes and uncertain puts prevent index publication", async () => {
  const manifest = await createPreviewStorageManifest(identity, [asset("index.html"), asset("a.js")]);
  for (const changed of [true, false]) {
    const writes: string[] = [];
    await expect(publishPreviewStorageManifest(manifest, { prefix: "builds/p/c", writer:testWriter,reserve: async () => {}, authorize: async () => {}, getFile: async () => changed ? new TextEncoder().encode("other") : bytes, bucket: { head: async () => null, put: async (key) => { writes.push(key); throw Error("unknown"); } } })).rejects.toThrow();
    expect(writes).toEqual(changed ? [] : ["builds/p/c/a.js"]);
  }
});
test("inspector uses standard Bun exec and rejects malformed output", async () => {
  await expect(inspectPreviewStorageManifest({ exec: async (argv) => { expect(argv.slice(0, 2)).toEqual(["bun", "-e"]); expect(argv[2]).toContain("isSymbolicLink"); return { success: true, stdout: JSON.stringify([asset("index.html")]) }; } }, identity)).resolves.toHaveProperty("totalBytes", bytes.length);
  await expect(inspectPreviewStorageManifest({ exec: async () => ({ success: true, stdout: "[{}]" }) }, identity)).rejects.toThrow();
});

test("actual inspector script hashes binaries and rejects filesystem symlinks", async () => {
  const { mkdtemp, writeFile, symlink, rm, truncate } = await import("node:fs/promises");
  const dir = await mkdtemp("/tmp/preview-manifest-test-");
  try {
    await writeFile(`${dir}/index.html`, bytes);
    const sandbox = { exec: async (argv: string[]) => {
      const script = argv[2]!.replaceAll('"/tmp/build-out"', JSON.stringify(dir));
      const result = Bun.spawnSync(["bun", "-e", script]);
      return { success: result.exitCode === 0, stdout: new TextDecoder().decode(result.stdout) };
    } };
    const manifest = await inspectPreviewStorageManifest(sandbox, identity);
    expect(manifest.assets).toEqual([asset("index.html")]);
    await symlink(`${dir}/index.html`, `${dir}/alias.html`);
    await expect(inspectPreviewStorageManifest(sandbox, identity)).rejects.toThrow("Could not inspect");
    await rm(`${dir}/alias.html`);
    await writeFile(`${dir}/bad\nname.js`,bytes);
    await expect(inspectPreviewStorageManifest(sandbox, identity)).rejects.toThrow();
    await rm(`${dir}/bad\nname.js`);
    await writeFile(`${dir}/large.js`,new Uint8Array());
    await truncate(`${dir}/large.js`,16*1024*1024+1);
    await expect(inspectPreviewStorageManifest(sandbox, identity)).rejects.toThrow("Could not inspect");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("matching retries skip uploads; legacy or mismatched assets are never overwritten", async () => {
  const manifest = await createPreviewStorageManifest(identity, [asset("index.html")]);
  let reads = 0, puts = 0, authorizations = 0;
  const options = { prefix: "builds/p/c", writer:testWriter,reserve: async () => {}, authorize: async () => { authorizations++; }, getFile: async () => { reads++; return bytes; }, bucket: { head: async () => ({ size: bytes.length, customMetadata: { sha256: digest, manifestHash: manifest.manifestHash } }), put: async () => { puts++; return {}; } } };
  await publishPreviewStorageManifest(manifest, options);
  expect([reads, puts, authorizations]).toEqual([0, 0, 2]);
  for (const existing of [{ size: bytes.length }, { size: bytes.length, customMetadata: { sha256: "other", manifestHash: manifest.manifestHash } }, { size: bytes.length + 1, customMetadata: { sha256: digest, manifestHash: manifest.manifestHash } }]) {
    await expect(publishPreviewStorageManifest(manifest, { ...options, bucket: { ...options.bucket, head: async () => existing } })).rejects.toThrow("conflicts");
  }
  expect([reads, puts]).toEqual([0, 0]);
});
test("conditional create conflict stops before index and retains the reservation", async () => {
  const manifest = await createPreviewStorageManifest(identity, [asset("a.js"), asset("index.html")]);
  const writes: string[] = [];
  await expect(publishPreviewStorageManifest(manifest, { prefix: "builds/p/c", writer:testWriter,reserve: async () => {}, authorize: async () => {}, getFile: async () => bytes, bucket: { head: async () => null, put: async (key, _bytes, options) => { writes.push(key); expect(options.onlyIf.etagDoesNotMatch).toBe("*"); return null; } } })).rejects.toThrow("unconfirmed");
  expect(writes).toEqual(["builds/p/c/a.js"]);
});

test("unknown provider put retains active writer and pending marker",async()=>{
 const events:string[]=[];const bytes=new TextEncoder().encode("asset"),digest=new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
 const manifest=await createPreviewStorageManifest(identity,[{path:"index.html",size:bytes.length,sha256:digest}]);
 await expect(publishPreviewStorageManifest(manifest,{prefix:"builds/p/c",reserve:async()=>{},writer:{begin:async()=>{events.push("writer");},beforePut:async()=>{events.push("pending");},settledPut:async()=>{events.push("settled");},finish:async()=>{events.push("closed");}},authorize:async()=>{},getFile:async()=>bytes,bucket:{head:async()=>null,put:async()=>{events.push("put");throw new Error("unknown outcome");}}})).rejects.toThrow("unknown outcome");
 expect(events).toEqual(["writer","pending","put"]);
});
