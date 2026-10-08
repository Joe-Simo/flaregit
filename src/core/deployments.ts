/** Static-site deployments. Files are stored by SHA-256 digest, each environment has one live manifest, and serving re-checks every byte it returns. */

export type Environment = "production" | "staging";

export interface Site {
  readonly name: string;
  readonly environments: readonly Environment[];
}

export type DeploymentStatus = "live" | "superseded" | "rolled_back";

export interface Deployment {
  readonly id: string;
  readonly sequence: number;
  readonly site: string;
  readonly environment: Environment;
  readonly commit: string;
  readonly actorId: string;
  /** Site path to the SHA-256 hex digest of that file's UTF-8 bytes. */
  readonly manifest: Readonly<Record<string, string>>;
  readonly manifestDigest: string;
  readonly bytes: number;
  readonly status: DeploymentStatus;
  readonly createdAt: string;
}

export interface DeploymentEvent {
  readonly action: "deploy" | "rollback";
  readonly actorId: string;
  /** The deployment that became live. */
  readonly deploymentId: string;
  readonly at: string;
}

export interface DeployRequest {
  readonly commit: string;
  readonly files: Readonly<Record<string, string>>;
  readonly actorId: string;
}

export type DeploymentFailureCode =
  | "invalid-input"
  | "invalid-path"
  | "too-large"
  | "not-deployed"
  | "no-previous-deployment"
  | "not-found"
  | "integrity-failure";

export interface DeploymentFailure {
  readonly ok: false;
  readonly code: DeploymentFailureCode;
  readonly error: string;
}

export type DeploymentResult<T> = {readonly ok: true; readonly value: T} | DeploymentFailure;

/** Total UTF-8 bytes across all files of one deployment. */
export const MAX_SITE_BYTES = 10 * 1024 * 1024;

const encoder = new TextEncoder();

interface StoredDeployment {
  readonly record: Omit<Deployment, "status">;
  status: DeploymentStatus;
}

interface Lane {
  readonly deployments: StoredDeployment[];
  readonly events: DeploymentEvent[];
}

function fail(code: DeploymentFailureCode, error: string): DeploymentFailure {
  return {ok: false, code, error};
}

function ok<T>(value: T): DeploymentResult<T> {
  return {ok: true, value};
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Relative paths only: no empty, '.' or '..' segments, no leading slash, no backslashes. */
function isCanonicalPath(path: string): boolean {
  if (path.includes("\\")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function checkTarget(site: Site, environment: Environment): DeploymentFailure | null {
  if (site.name.trim() === "") return fail("invalid-input", "A site needs a name");
  if (!site.environments.includes(environment)) return fail("invalid-input", `${site.name} does not deploy to ${environment}`);
  return null;
}

function laneKey(siteName: string, environment: Environment): string {
  return JSON.stringify([siteName, environment]);
}

function view(stored: StoredDeployment): Deployment {
  return Object.freeze({...stored.record, status: stored.status});
}

export class InMemoryDeploymentStore {
  private readonly lanes = new Map<string, Lane>();
  private readonly blobs: Map<string, string>;
  private readonly clock: () => Date;
  private sequence = 0;

  /** `blobs` maps digest to stored content. It is injectable so tests can simulate tampering. */
  constructor(options: {readonly clock?: () => Date; readonly blobs?: Map<string, string>} = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.blobs = options.blobs ?? new Map();
  }

  async deploy(site: Site, environment: Environment, request: DeployRequest): Promise<DeploymentResult<Deployment>> {
    const target = checkTarget(site, environment);
    if (target) return target;
    if (request.commit.trim() === "") return fail("invalid-input", "A deployment needs a commit");
    if (request.actorId.trim() === "") return fail("invalid-input", "A deployment needs an actor");
    const entries = Object.entries(request.files).sort(([a], [b]) => (a < b ? -1 : 1));
    if (entries.length === 0) return fail("invalid-input", "A deployment needs at least one file");
    for (const [path] of entries) {
      if (!isCanonicalPath(path)) return fail("invalid-path", `Path "${path}" must be relative, with no '..', '.', empty segments or backslashes`);
    }
    const encoded = entries.map(([path, content]) => ({path, content, bytes: encoder.encode(content)}));
    const size = encoded.reduce((sum, file) => sum + file.bytes.byteLength, 0);
    if (size > MAX_SITE_BYTES) return fail("too-large", `Deployment is ${size} bytes; the limit is ${MAX_SITE_BYTES}`);
    const files = await Promise.all(encoded.map(async (file) => ({...file, digest: await sha256Hex(file.bytes)})));
    const manifestDigest = await sha256Hex(encoder.encode(JSON.stringify(files.map((file) => [file.path, file.digest]))));

    // Everything below runs synchronously, so no other deploy can interleave with this state change.
    const key = laneKey(site.name, environment);
    const lane: Lane = this.lanes.get(key) ?? {deployments: [], events: []};
    const sequence = this.sequence + 1;
    const createdAt = this.clock().toISOString();
    const record: Omit<Deployment, "status"> = Object.freeze({
      id: `dep-${sequence}`,
      sequence,
      site: site.name,
      environment,
      commit: request.commit,
      actorId: request.actorId,
      manifest: Object.freeze(Object.fromEntries(files.map((file) => [file.path, file.digest]))),
      manifestDigest,
      bytes: size,
      createdAt,
    });
    for (const file of files) {
      if (!this.blobs.has(file.digest)) this.blobs.set(file.digest, file.content);
    }
    for (const stored of lane.deployments) {
      if (stored.status === "live") stored.status = "superseded";
    }
    const stored: StoredDeployment = {record, status: "live"};
    lane.deployments.push(stored);
    lane.events.push({action: "deploy", actorId: request.actorId, deploymentId: record.id, at: createdAt});
    this.lanes.set(key, lane);
    this.sequence = sequence;
    return ok(view(stored));
  }

  /** Restores the newest superseded deployment older than the live one. The live deployment becomes rolled_back and is never deleted. */
  rollback(site: Site, environment: Environment, actorId: string): DeploymentResult<Deployment> {
    const target = checkTarget(site, environment);
    if (target) return target;
    if (actorId.trim() === "") return fail("invalid-input", "A rollback needs an actor");
    const lane = this.lanes.get(laneKey(site.name, environment));
    const current = lane?.deployments.find((stored) => stored.status === "live");
    if (!lane || !current) return fail("not-deployed", `Nothing is live in ${environment} for ${site.name}`);
    const previous = lane.deployments.findLast(
      (stored) => stored.status === "superseded" && stored.record.sequence < current.record.sequence,
    );
    if (!previous) return fail("no-previous-deployment", `No earlier deployment in ${environment} can be restored`);
    current.status = "rolled_back";
    previous.status = "live";
    lane.events.push({action: "rollback", actorId, deploymentId: previous.record.id, at: this.clock().toISOString()});
    return ok(view(previous));
  }

  /** Returns a file from the live deployment only after its bytes hash to the digest in the live manifest. */
  async serve(site: Site, environment: Environment, path: string): Promise<DeploymentResult<{readonly content: string; readonly deploymentId: string}>> {
    const target = checkTarget(site, environment);
    if (target) return target;
    if (!isCanonicalPath(path)) return fail("invalid-path", `Path "${path}" is not a valid site path`);
    const live = this.liveEntry(site.name, environment);
    if (!live) return fail("not-deployed", `Nothing is live in ${environment} for ${site.name}`);
    const {manifest} = live.record;
    const digest = Object.hasOwn(manifest, path) ? manifest[path] : undefined;
    if (digest === undefined) return fail("not-found", `${path} is not in the live ${environment} deployment`);
    const content = this.blobs.get(digest);
    if (content === undefined) return fail("integrity-failure", `Stored content for ${path} is missing`);
    if ((await sha256Hex(encoder.encode(content))) !== digest) return fail("integrity-failure", `Stored content for ${path} does not match its digest`);
    return ok({content, deploymentId: live.record.id});
  }

  live(site: Site, environment: Environment): Deployment | null {
    const stored = this.liveEntry(site.name, environment);
    return stored ? view(stored) : null;
  }

  /** Every deployment ever made in this environment, oldest first. */
  deployments(site: Site, environment: Environment): readonly Deployment[] {
    return (this.lanes.get(laneKey(site.name, environment))?.deployments ?? []).map(view);
  }

  history(site: Site, environment: Environment): readonly DeploymentEvent[] {
    return (this.lanes.get(laneKey(site.name, environment))?.events ?? []).map((event) => Object.freeze({...event}));
  }

  private liveEntry(siteName: string, environment: Environment): StoredDeployment | undefined {
    return this.lanes.get(laneKey(siteName, environment))?.deployments.find((stored) => stored.status === "live");
  }
}
