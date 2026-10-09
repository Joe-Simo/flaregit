/** F12 slice: in-memory package registry. Versions are immutable, file bytes are digest-checked on read, and reads apply package-visibility. Nothing is persisted. */

import { canPublish, visiblePackages, type PackageRecord } from "./package-visibility";

/** Total UTF-8 bytes of one version's files. */
export const MAX_PACKAGE_BYTES = 10 * 1024 * 1024;
export class PackageCapacityError extends Error {}

export type RegistryStatus = 400 | 403 | 404 | 409 | 413 | 500;

export interface RegistryFailure {
  readonly ok: false;
  readonly status: RegistryStatus;
  readonly error: string;
}

/** The reader. `id` is undefined for anonymous viewers; `memberOf` lists the owners whose private packages they may see. */
export interface Viewer {
  readonly id: string | undefined;
  readonly memberOf: readonly string[];
}

export interface PublishInput {
  readonly name: string;
  readonly version: string;
  readonly files: Readonly<Record<string, string>>;
  readonly ownerId: string;
  /** Defaults to public. The first publish of a name fixes its visibility and owner. */
  readonly private?: boolean;
}

export interface FileDigest {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface VersionMetadata {
  readonly version: string;
  /** Null while the version is not deprecated. Deprecated versions stay listed and fetchable. */
  readonly deprecated: string | null;
  readonly dist: {
    /** "sha256:" plus SHA-256 over the path-sorted lines `path NUL sha256 LF`. */
    readonly integrity: string;
    readonly files: readonly FileDigest[];
  };
}

export interface PackageMetadata {
  readonly name: string;
  /** Newest first by semver precedence. */
  readonly versions: readonly VersionMetadata[];
}

export type PublishResult = { readonly ok: true; readonly name: string; readonly version: string; readonly integrity: string } | RegistryFailure;
export type DeprecateResult = { readonly ok: true } | RegistryFailure;
export type MetadataResult = { readonly ok: true; readonly metadata: PackageMetadata } | RegistryFailure;
export type FetchResult = { readonly ok: true; readonly content: string } | RegistryFailure;
export type ResolveResult = { readonly ok: true; readonly version: string; readonly integrity: string } | RegistryFailure;

export interface StoredFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface StoredVersion extends PackageRecord {
  /** Immutable order assigned by the registry at the synchronous version write. */
  readonly publication?: number;
  readonly files: ReadonlyMap<string, StoredFile>;
  readonly integrity: string;
  readonly deprecated: string | null;
}

/** Storage contract. A version written once is never replaced; only its deprecation message can change. */
export interface PackageStore {
  versionsOf(name: string): StoredVersion[];
  getVersion(name: string, version: string): StoredVersion | undefined;
  /** Throws if the name and version already exist. */
  putVersion(stored: StoredVersion): void;
  setDeprecation(name: string, version: string, message: string): void;
}

export class MemoryPackageStore implements PackageStore {
  private readonly packages = new Map<string, Map<string, StoredVersion>>();

  versionsOf(name: string): StoredVersion[] {
    return [...(this.packages.get(name)?.values() ?? [])];
  }

  getVersion(name: string, version: string): StoredVersion | undefined {
    return this.packages.get(name)?.get(version);
  }

  putVersion(stored: StoredVersion): void {
    let versions = this.packages.get(stored.name);
    if (versions === undefined) {
      versions = new Map();
      this.packages.set(stored.name, versions);
    }
    if (versions.has(stored.version)) throw new Error(`${stored.name}@${stored.version} is already stored`);
    versions.set(stored.version, stored);
  }

  setDeprecation(name: string, version: string, message: string): void {
    const versions = this.packages.get(name);
    const stored = versions?.get(version);
    if (versions === undefined || stored === undefined) throw new Error(`${name}@${version} is not stored`);
    versions.set(version, { ...stored, deprecated: message });
  }
}

const INVALID_NAME = "Package names are 1-100 characters of lowercase letters, digits, '-', '_' or '.', and cannot start with a dot";
const INVALID_VERSION = "Versions must be semantic x.y.z with an optional prerelease";
const PACKAGE_NAME = /^(?:(?!\.)[a-z0-9._-]{1,100}|@[a-z0-9_-]{1,100}\/(?!\.)[a-z0-9._-]{1,100})$/;
const PRERELEASE_ID = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`;
const VERSION = new RegExp(String.raw`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(${PRERELEASE_ID}(?:\.${PRERELEASE_ID})*))?$`);
const X_MAJOR = /^(0|[1-9]\d*)\.[xX*](?:\.[xX*])?$/;
const X_MINOR = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.[xX*]$/;
const NUMERIC_ID = /^\d+$/;

type PrereleaseId = bigint | string;

interface ParsedVersion {
  readonly major: bigint;
  readonly minor: bigint;
  readonly patch: bigint;
  /** Null for a release. */
  readonly pre: readonly PrereleaseId[] | null;
}

function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION.exec(value);
  if (match === null) return null;
  const [, major, minor, patch, pre] = match;
  return {
    major: BigInt(major!),
    minor: BigInt(minor!),
    patch: BigInt(patch!),
    pre: pre === undefined ? null : pre.split(".").map((id) => (NUMERIC_ID.test(id) ? BigInt(id) : id)),
  };
}

const compareBig = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function compareCore(a: ParsedVersion, b: ParsedVersion): number {
  return compareBig(a.major, b.major) || compareBig(a.minor, b.minor) || compareBig(a.patch, b.patch);
}

/** Semver 2.0 identifier precedence: numeric identifiers compare as numbers, they sort below text, and a longer list wins a tie. */
function comparePrerelease(a: readonly PrereleaseId[] | null, b: readonly PrereleaseId[] | null): number {
  if (a === null || b === null) {
    if (a === null && b === null) return 0;
    return a === null ? 1 : -1;
  }
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const left = a[index]!;
    const right = b[index]!;
    if (typeof left === "bigint" && typeof right === "bigint") {
      const diff = compareBig(left, right);
      if (diff !== 0) return diff;
    } else if (typeof left === "bigint") {
      return -1;
    } else if (typeof right === "bigint") {
      return 1;
    } else if (left !== right) {
      return compareText(left, right);
    }
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function compareParsed(a: ParsedVersion, b: ParsedVersion): number {
  return compareCore(a, b) || comparePrerelease(a.pre, b.pre);
}

/** Semver precedence for two valid versions. Build metadata is not part of the accepted grammar. */
export function compareSemver(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null || right === null) throw new RangeError("compareSemver needs valid semver versions");
  return compareParsed(left, right);
}

type VersionRange =
  | { readonly kind: "exact"; readonly base: ParsedVersion }
  | { readonly kind: "caret"; readonly base: ParsedVersion }
  | { readonly kind: "x"; readonly major: bigint; readonly minor: bigint | null };

/** Accepts `x.y.z[-pre]`, `^x.y.z[-pre]`, `1.x`, `1.x.x`, `1.2.x` and `1.2.*`. Every other form is refused. */
function parseRange(range: string): VersionRange | null {
  if (range.startsWith("^")) {
    const base = parseVersion(range.slice(1));
    return base === null ? null : { kind: "caret", base };
  }
  const exact = parseVersion(range);
  if (exact !== null) return { kind: "exact", base: exact };
  const majorOnly = X_MAJOR.exec(range);
  if (majorOnly !== null) return { kind: "x", major: BigInt(majorOnly[1]!), minor: null };
  const withMinor = X_MINOR.exec(range);
  if (withMinor !== null) return { kind: "x", major: BigInt(withMinor[1]!), minor: BigInt(withMinor[2]!) };
  return null;
}

const release = (major: bigint, minor: bigint, patch: bigint): ParsedVersion => ({ major, minor, patch, pre: null });

function matchesRange(version: ParsedVersion, range: VersionRange): boolean {
  const base = range.kind === "x" ? null : range.base;
  // A prerelease matches only when the range names a prerelease on the same major.minor.patch (npm semantics).
  if (version.pre !== null && (base === null || base.pre === null || compareCore(version, base) !== 0)) return false;
  if (range.kind === "exact") return compareParsed(version, range.base) === 0;
  if (range.kind === "caret") {
    if (compareParsed(version, range.base) < 0) return false;
    const ceiling =
      range.base.major > 0n ? release(range.base.major + 1n, 0n, 0n) : range.base.minor > 0n ? release(0n, range.base.minor + 1n, 0n) : release(0n, 0n, range.base.patch + 1n);
    return compareCore(version, ceiling) < 0;
  }
  const floor = release(range.major, range.minor ?? 0n, 0n);
  const ceiling = range.minor === null ? release(range.major + 1n, 0n, 0n) : release(range.major, range.minor + 1n, 0n);
  return compareCore(version, floor) >= 0 && compareCore(version, ceiling) < 0;
}

function isPackageName(value: unknown): value is string {
  return typeof value === "string" && PACKAGE_NAME.test(value);
}

function isVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION.test(value);
}

/** Relative, normalised paths only: no leading slash, no `..`, no backslash, NUL, empty or `.` segments. */
function isValidPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("..") &&
    !value.includes("\\") &&
    !value.includes("\u0000") &&
    value.split("/").every((segment) => segment !== "" && segment !== ".")
  );
}

function fail(status: RegistryStatus, error: string): RegistryFailure {
  return { ok: false, status, error };
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function integrityOf(files: readonly FileDigest[]): Promise<string> {
  const manifest = [...files]
    .sort((a, b) => compareText(a.path, b.path))
    .map((file) => `${file.path}\u0000${file.sha256}\n`)
    .join("");
  return `sha256:${await sha256Hex(new TextEncoder().encode(manifest))}`;
}

function toVersionMetadata(stored: StoredVersion): VersionMetadata {
  const files = [...stored.files.values()]
    .sort((a, b) => compareText(a.path, b.path))
    .map(({ path, sha256, size }): FileDigest => ({ path, sha256, size }));
  return { version: stored.version, deprecated: stored.deprecated, dist: { integrity: stored.integrity, files } };
}

export class PackageRegistry {
  constructor(private readonly store: PackageStore = new MemoryPackageStore()) {}

  async publish(input: PublishInput): Promise<PublishResult> {
    if (typeof input.files !== "object" || input.files === null) return fail(400, "files must map paths to text");
    const files: Record<string, Uint8Array<ArrayBuffer>> = {};
    for (const [path, content] of Object.entries(input.files)) {
      if (typeof content !== "string") return fail(400, `File ${path} must be text`);
      files[path] = new TextEncoder().encode(content);
    }
    return this.publishBinary({ ...input, files });
  }

  async publishBinary(input: Omit<PublishInput, "files"> & { readonly files: Readonly<Record<string, Uint8Array<ArrayBuffer>>> }): Promise<PublishResult> {
    const { name, version, ownerId } = input;
    if (!isPackageName(name)) return fail(400, INVALID_NAME);
    if (!isVersion(version)) return fail(400, INVALID_VERSION);
    if (typeof ownerId !== "string" || ownerId.trim() === "") return fail(400, "Publishing needs an owner id");
    if (input.private !== undefined && typeof input.private !== "boolean") return fail(400, "private must be true or false");
    if (typeof input.files !== "object" || input.files === null) return fail(400, "files must map paths to text");

    const entries = Object.entries(input.files);
    if (entries.length === 0) return fail(400, "A package needs at least one file");
    let totalBytes = 0;
    const encoded: { readonly path: string; readonly bytes: Uint8Array<ArrayBuffer> }[] = [];
    for (const [path, content] of entries) {
      if (!isValidPath(path)) return fail(400, `File path ${JSON.stringify(path)} is not allowed`);
      if (!(content instanceof Uint8Array)) return fail(400, `File ${path} must be bytes`);
      const bytes = content.slice();
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_PACKAGE_BYTES) return fail(413, `Package files exceed ${MAX_PACKAGE_BYTES} bytes`);
      encoded.push({ path, bytes });
    }

    const files = await Promise.all(
      encoded.map(async ({ path, bytes }): Promise<StoredFile> => ({ path, sha256: await sha256Hex(bytes), size: bytes.byteLength, bytes })),
    );
    const integrity = await integrityOf(files);

    // Checks and the write run after the last await, so two concurrent publishes of one version cannot both pass.
    const existing = this.store.versionsOf(name);
    const owner = existing[0];
    if (owner !== undefined && owner.ownerId !== ownerId) return fail(403, `${name} belongs to another owner`);
    const isPrivate = input.private === true;
    if (owner !== undefined && owner.private !== isPrivate) return fail(409, `${name} keeps the visibility of its first publish`);
    if (!canPublish(existing, name, version)) return fail(409, `${name}@${version} is already published and cannot change`);
    try { this.store.putVersion({
      name,
      version,
      private: isPrivate,
      ownerId,
      files: new Map(files.map((file): [string, StoredFile] => [file.path, file])),
      integrity,
      deprecated: null,
      publication: existing.length + 1,
    }); } catch (error) {
      if (error instanceof PackageCapacityError) return fail(413, error.message);
      throw error;
    }
    return { ok: true, name, version, integrity };
  }

  /** Stored insertion order, independent of semantic version precedence. Legacy rows retain store insertion order. */
  publicationOrder(name:string,viewer:Viewer):ReadonlyMap<string,number>{return new Map(this.visibleVersions(name,viewer).map((version,index)=>[version.version,version.publication??index+1]));}

  metadata(name: string, viewer: Viewer): MetadataResult {
    if (!isPackageName(name)) return fail(400, INVALID_NAME);
    const visible = this.visibleVersions(name, viewer);
    if (visible.length === 0) return fail(404, `${name} was not found`);
    const versions = [...visible].sort((a, b) => compareSemver(b.version, a.version)).map(toVersionMetadata);
    return { ok: true, metadata: { name, versions } };
  }

  /** Returns content only after the stored bytes match the digest recorded at publish. */
  async fetchFile(name: string, version: string, path: string, viewer: Viewer): Promise<FetchResult> {
    const result = await this.fetchBytes(name, version, path, viewer);
    return result.ok ? { ok: true, content: new TextDecoder().decode(result.bytes) } : result;
  }

  async fetchBytes(name: string, version: string, path: string, viewer: Viewer): Promise<{ readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> } | RegistryFailure> {
    if (!isPackageName(name) || !isVersion(version) || !isValidPath(path)) return fail(400, "Package name, version or file path is invalid");
    const stored = this.store.getVersion(name, version);
    if (stored === undefined || visiblePackages([stored], viewer.id, viewer.memberOf).length === 0) return fail(404, `${name}@${version} was not found`);
    const file = stored.files.get(path);
    if (file === undefined) return fail(404, `${name}@${version} has no file ${path}`);
    // Hash and decode the same copy, so the bytes returned are the bytes verified.
    const bytes = file.bytes.slice();
    if ((await sha256Hex(bytes)) !== file.sha256) return fail(500, `Stored ${name}@${version} ${path} failed digest verification`);
    return { ok: true, bytes };
  }

  /** Marks a version deprecated. The version stays listed and fetchable; resolve stops choosing it. */
  deprecate(name: string, version: string, message: string, ownerId: string): DeprecateResult {
    if (!isPackageName(name) || !isVersion(version)) return fail(400, "Package name or version is invalid");
    if (typeof message !== "string" || message.trim() === "") return fail(400, "A deprecation needs a message");
    const stored = this.store.getVersion(name, version);
    if (stored === undefined) return fail(404, `${name}@${version} was not found`);
    if (stored.ownerId !== ownerId) {
      // Private packages answer as missing to non-owners so their existence does not leak.
      return stored.private ? fail(404, `${name}@${version} was not found`) : fail(403, "Only the package owner can deprecate versions");
    }
    this.store.setDeprecation(name, version, message);
    return { ok: true };
  }

  /** Picks the highest non-deprecated visible version that satisfies an exact, caret or x-range spec. */
  resolve(name: string, range: string, viewer: Viewer): ResolveResult {
    if (!isPackageName(name)) return fail(400, INVALID_NAME);
    const parsedRange = parseRange(range);
    if (parsedRange === null) return fail(400, `Unsupported version range ${JSON.stringify(range)}. Use x.y.z, ^x.y.z, or an x-range such as 1.x or 1.2.x`);
    const candidates = this.visibleVersions(name, viewer).filter((stored) => {
      const parsed = parseVersion(stored.version);
      return parsed !== null && stored.deprecated === null && matchesRange(parsed, parsedRange);
    });
    const [best] = candidates.sort((a, b) => compareSemver(b.version, a.version));
    if (best === undefined) return fail(404, `No non-deprecated version of ${name} matches ${range}`);
    return { ok: true, version: best.version, integrity: best.integrity };
  }

  private visibleVersions(name: string, viewer: Viewer): StoredVersion[] {
    const all = this.store.versionsOf(name);
    const visible = new Set<PackageRecord>(visiblePackages(all, viewer.id, viewer.memberOf));
    return all.filter((stored) => visible.has(stored));
  }
}
