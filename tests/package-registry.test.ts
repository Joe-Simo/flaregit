import { expect, test } from "bun:test";
import { MAX_PACKAGE_BYTES, MemoryPackageStore, PackageRegistry, compareSemver, type Viewer } from "../src/core/package-registry";

const anonymous: Viewer = { id: undefined, memberOf: [] };
const outsider: Viewer = { id: "alice", memberOf: [] };
const owner: Viewer = { id: "acme", memberOf: [] };
const member: Viewer = { id: "carol", memberOf: ["acme"] };

const base = { name: "widget", version: "1.0.0", files: { "index.ts": "export const widget = 1;\n" }, ownerId: "acme" };

function unwrap<T extends { readonly ok: boolean }>(result: T): Extract<T, { readonly ok: true }> {
  if (!result.ok) throw new Error(`Expected success, got ${JSON.stringify(result)}`);
  return result as Extract<T, { readonly ok: true }>;
}

async function publishVersions(registry: PackageRegistry, name: string, versions: readonly string[]): Promise<void> {
  for (const version of versions) unwrap(await registry.publish({ ...base, name, version, files: { "index.ts": version } }));
}

test("republishing a version is refused and the first publish stays intact", async () => {
  const registry = new PackageRegistry();
  unwrap(await registry.publish(base));

  expect(await registry.publish({ ...base, files: { "index.ts": "changed" } })).toMatchObject({ ok: false, status: 409 });
  expect(await registry.publish(base)).toMatchObject({ ok: false, status: 409 });

  expect(unwrap(registry.metadata("widget", anonymous)).metadata.versions.map((version) => version.version)).toEqual(["1.0.0"]);
  expect(await registry.fetchFile("widget", "1.0.0", "index.ts", anonymous)).toEqual({ ok: true, content: base.files["index.ts"] });
});

test("file paths that escape the package or are not normalised are refused and nothing is stored", async () => {
  const registry = new PackageRegistry();
  const paths = ["../escape.ts", "src/../../escape.ts", "/etc/passwd", "a/..", "dir\\..\\x.ts", "a//b.ts", "./a.ts", "src/", ""];
  for (const path of paths) {
    expect(await registry.publish({ ...base, files: { [path]: "x" } })).toMatchObject({ ok: false, status: 400 });
  }
  expect(registry.metadata("widget", anonymous)).toMatchObject({ ok: false, status: 404 });
  expect(await registry.fetchFile("widget", "1.0.0", "../escape.ts", anonymous)).toMatchObject({ ok: false, status: 400 });
});

test("total package size is capped at 10 MB of UTF-8 bytes, not characters", async () => {
  const registry = new PackageRegistry();
  unwrap(await registry.publish({ ...base, name: "at-limit", files: { "a.txt": "a".repeat(MAX_PACKAGE_BYTES - 1), "b.txt": "b" } }));
  expect(await registry.publish({ ...base, name: "over-limit", files: { "a.txt": "a".repeat(MAX_PACKAGE_BYTES), "b.txt": "b" } })).toMatchObject({ ok: false, status: 413 });

  // Each "é" is two bytes, so half as many characters already fills the cap.
  unwrap(await registry.publish({ ...base, name: "multibyte-limit", files: { "a.txt": "é".repeat(MAX_PACKAGE_BYTES / 2) } }));
  expect(await registry.publish({ ...base, name: "multibyte-over", files: { "a.txt": "é".repeat(MAX_PACKAGE_BYTES / 2 + 1) } })).toMatchObject({ ok: false, status: 413 });
});

test("private packages are hidden from anonymous viewers and outsiders, and visible to the owner and its members", async () => {
  const registry = new PackageRegistry();
  unwrap(await registry.publish({ ...base, name: "secret", private: true }));

  for (const viewer of [anonymous, outsider]) {
    expect(registry.metadata("secret", viewer)).toMatchObject({ ok: false, status: 404 });
    expect(await registry.fetchFile("secret", "1.0.0", "index.ts", viewer)).toMatchObject({ ok: false, status: 404 });
    expect(registry.resolve("secret", "1.0.0", viewer)).toMatchObject({ ok: false, status: 404 });
  }
  for (const viewer of [owner, member]) {
    expect(unwrap(registry.metadata("secret", viewer)).metadata.versions).toHaveLength(1);
    expect(await registry.fetchFile("secret", "1.0.0", "index.ts", viewer)).toMatchObject({ ok: true });
  }
});

test("a package keeps its first owner and visibility across later versions", async () => {
  const registry = new PackageRegistry();
  unwrap(await registry.publish({ ...base, name: "owned", private: true }));

  expect(await registry.publish({ ...base, name: "owned", version: "1.1.0", ownerId: "mallory", private: true })).toMatchObject({ ok: false, status: 403 });
  expect(await registry.publish({ ...base, name: "owned", version: "1.1.0" })).toMatchObject({ ok: false, status: 409 });
  expect(await registry.publish({ ...base, name: "owned", version: "1.1.0", private: "yes" as unknown as boolean })).toMatchObject({ ok: false, status: 400 });
  expect(unwrap(registry.metadata("owned", owner)).metadata.versions.map((version) => version.version)).toEqual(["1.0.0"]);
});

test("fetching a file re-verifies its digest and refuses bytes changed after publish", async () => {
  const store = new MemoryPackageStore();
  const registry = new PackageRegistry(store);
  unwrap(await registry.publish({ ...base, name: "tamper", files: { "index.ts": "good", "other.ts": "fine" } }));

  const bytes = store.getVersion("tamper", "1.0.0")!.files.get("index.ts")!.bytes;
  bytes[0] = bytes[0]! ^ 0x20;

  expect(await registry.fetchFile("tamper", "1.0.0", "index.ts", anonymous)).toMatchObject({ ok: false, status: 500 });
  expect(await registry.fetchFile("tamper", "1.0.0", "other.ts", anonymous)).toEqual({ ok: true, content: "fine" });
});

test("the integrity digest ignores file order and changes when a file's content or path changes", async () => {
  const registry = new PackageRegistry();
  const first = unwrap(await registry.publish({ ...base, name: "order-a", files: { "a.ts": "1", "b.ts": "2" } }));
  const reordered = unwrap(await registry.publish({ ...base, name: "order-b", files: { "b.ts": "2", "a.ts": "1" } }));
  const changedContent = unwrap(await registry.publish({ ...base, name: "order-c", files: { "a.ts": "1", "b.ts": "3" } }));
  const renamed = unwrap(await registry.publish({ ...base, name: "order-d", files: { "a.ts": "1", "c.ts": "2" } }));

  expect(reordered.integrity).toBe(first.integrity);
  expect(changedContent.integrity).not.toBe(first.integrity);
  expect(renamed.integrity).not.toBe(first.integrity);
});

test("resolve skips deprecated versions while metadata and fetch keep them", async () => {
  const registry = new PackageRegistry();
  await publishVersions(registry, "widget", ["1.0.0", "1.1.0", "1.2.0"]);

  expect(registry.deprecate("widget", "1.2.0", "use 1.1.0", "stranger")).toMatchObject({ ok: false, status: 403 });
  expect(registry.deprecate("widget", "1.9.0", "use 1.1.0", "acme")).toMatchObject({ ok: false, status: 404 });
  expect(registry.deprecate("widget", "1.2.0", "  ", "acme")).toMatchObject({ ok: false, status: 400 });
  expect(registry.deprecate("widget", "1.2.0", "use 1.1.0", "acme")).toEqual({ ok: true });

  expect(unwrap(registry.resolve("widget", "^1.0.0", anonymous)).version).toBe("1.1.0");
  expect(registry.resolve("widget", "1.2.0", anonymous)).toMatchObject({ ok: false, status: 404 });

  const listed = unwrap(registry.metadata("widget", anonymous)).metadata.versions;
  expect(listed[0]).toMatchObject({ version: "1.2.0", deprecated: "use 1.1.0" });
  expect(await registry.fetchFile("widget", "1.2.0", "index.ts", anonymous)).toEqual({ ok: true, content: "1.2.0" });
});

test("metadata lists versions newest first by semver precedence", async () => {
  const registry = new PackageRegistry();
  await publishVersions(registry, "widget", ["1.2.0-alpha", "1.10.0", "1.2.0-beta.11", "1.2.0", "2.0.0", "1.9.9", "1.2.0-beta.2", "1.2.0-beta"]);

  expect(unwrap(registry.metadata("widget", anonymous)).metadata.versions.map((version) => version.version)).toEqual([
    "2.0.0",
    "1.10.0",
    "1.9.9",
    "1.2.0",
    "1.2.0-beta.11",
    "1.2.0-beta.2",
    "1.2.0-beta",
    "1.2.0-alpha",
  ]);
});

test("compareSemver follows the semver 2.0 precedence chain", () => {
  const chain = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0", "10.0.0", "9007199254740993.0.0"];
  for (let index = 0; index + 1 < chain.length; index++) {
    expect(compareSemver(chain[index]!, chain[index + 1]!)).toBeLessThan(0);
  }
});

test("resolve picks the highest match for exact, caret and x-ranges and never a prerelease outside the named tuple", async () => {
  const registry = new PackageRegistry();
  await publishVersions(registry, "widget", ["0.2.3", "0.2.9", "0.3.0", "1.0.0", "1.4.2", "1.5.0-beta.1", "2.0.0"]);
  const resolveTo = (range: string) => unwrap(registry.resolve("widget", range, anonymous)).version;

  expect(resolveTo("0.2.3")).toBe("0.2.3");
  expect(resolveTo("^0.2.3")).toBe("0.2.9");
  expect(resolveTo("^0.3.0")).toBe("0.3.0");
  expect(resolveTo("^1.0.0")).toBe("1.4.2");
  expect(resolveTo("^2.0.0")).toBe("2.0.0");
  expect(resolveTo("1.x")).toBe("1.4.2");
  expect(resolveTo("1.4.x")).toBe("1.4.2");
  expect(resolveTo("1.4.*")).toBe("1.4.2");
  expect(resolveTo("1.5.0-beta.1")).toBe("1.5.0-beta.1");
  expect(resolveTo("^1.5.0-beta.0")).toBe("1.5.0-beta.1");
  expect(registry.resolve("widget", "^3.0.0", anonymous)).toMatchObject({ ok: false, status: 404 });
  expect(registry.resolve("widget", "1.6.x", anonymous)).toMatchObject({ ok: false, status: 404 });
});

test("resolve refuses version ranges outside the supported grammar", () => {
  const registry = new PackageRegistry();
  const unsupported = ["~1.2.3", ">=1.0.0", ">1.0.0", "1.2", "1", "*", "x", "latest", "1.x.3", "^1.x", "^^1.0.0", " 1.0.0", "v1.0.0", "1.0.0 || 2.0.0", "1.0.0 - 2.0.0"];
  for (const range of unsupported) {
    expect(registry.resolve("widget", range, anonymous)).toMatchObject({ ok: false, status: 400 });
  }
});

test("package names and versions follow the registry grammar", async () => {
  const registry = new PackageRegistry();
  for (const name of ["Widget", ".hidden", "has space", "", "x".repeat(101), "slash/name", "@scope/pkg"]) {
    expect(await registry.publish({ ...base, name })).toMatchObject({ ok: false, status: 400 });
  }
  unwrap(await registry.publish({ ...base, name: "x".repeat(100) }));

  for (const version of ["1.0", "01.0.0", "v1.0.0", "1.0.0+build.1", "1.0.0-", "1.0.0-01", "1.0.0 "]) {
    expect(await registry.publish({ ...base, name: "versions", version })).toMatchObject({ ok: false, status: 400 });
  }
  unwrap(await registry.publish({ ...base, name: "versions", version: "1.0.0-rc.1" }));
});
