import type {
  ArtifactsClient,
  ArtifactsCommit,
  ArtifactsFileContent,
  ArtifactsRepoHandle,
  ArtifactsRepoMetadata,
} from "./types.js";

/** Minimal shape of the documented Artifacts Workers binding (env.ARTIFACTS). */
export interface ArtifactsBinding {
  create(name: string, opts?: Record<string, unknown>): Promise<{ name: string; remote: string; defaultBranch: string; token?: string }>;
  get(name: string): Promise<ArtifactsRepoCapability>;
  list(opts?: Record<string, unknown>): Promise<{ repos: Array<Record<string, any>>; cursor?: string }>;
  import(params: Record<string, unknown>): Promise<{ name: string; remote: string; defaultBranch?: string; token?: string }>;
  delete(name: string): Promise<boolean>;
}

interface ArtifactsRepoCapability {
  info(): Promise<Record<string, any>>;
  createToken(scope?: "read" | "write", ttl?: number): Promise<{ plaintext: string; expiresAt?: string }>;
  revokeToken(tokenOrId: string): Promise<boolean>;
  fork(name: string, opts?: Record<string, unknown>): Promise<{ name: string; remote: string; defaultBranch?: string; token?: string }>;
  log(opts?: Record<string, unknown>): Promise<Array<Record<string, any>>>;
  readCommit(hash: string): Promise<Record<string, any> | null>;
  readFile(args: { ref: string; path: string }): Promise<Blob | null>;
}

const toCommit = (c: Record<string, any>): ArtifactsCommit => ({
  hash: c.hash ?? c.sha,
  author: c.author?.name ?? c.author ?? "",
  email: c.author?.email ?? c.email ?? "",
  timestamp: c.timestamp ?? c.author?.timestamp ?? "",
  message: c.message ?? "",
  parents: c.parents ?? [],
});

class BindingRepoHandle implements ArtifactsRepoHandle {
  constructor(private readonly repo: ArtifactsRepoCapability, private readonly name: string) {}

  async info(): Promise<ArtifactsRepoMetadata> {
    const i = await this.repo.info();
    return { id: i.id ?? this.name, name: i.name ?? this.name, description: i.description ?? null, defaultBranch: i.defaultBranch ?? "main", remote: i.remote };
  }
  createToken(scope: "read" | "write" = "write", ttl = 3600) {
    return this.repo.createToken(scope, ttl).then((t) => ({
      plaintext: t.plaintext,
      expiresAt: t.expiresAt ?? new Date(Date.now() + ttl * 1000).toISOString(),
    }));
  }
  async fork(name: string, opts?: { description?: string; readOnly?: boolean; defaultBranchOnly?: boolean }) {
    const f = await this.repo.fork(name, opts);
    return { id: f.name, name: f.name, description: opts?.description ?? null, defaultBranch: f.defaultBranch ?? "main", remote: f.remote, token: f.token };
  }
  async log(opts?: { ref?: string; limit?: number; offset?: number }) {
    return (await this.repo.log(opts)).map(toCommit);
  }
  async readCommit(hash: string) {
    const c = await this.repo.readCommit(hash);
    return c ? toCommit(c) : null;
  }
  async readFile(args: { ref: string; path: string }): Promise<ArtifactsFileContent | null> {
    const blob = await this.repo.readFile(args);
    return blob ? { text: () => blob.text(), type: blob.type } : null;
  }
  dispose(): void {}
  [Symbol.dispose](): void {}
  async [Symbol.asyncDispose](): Promise<void> {}
}

/** ArtifactsClient backed by the documented `env.ARTIFACTS` Workers binding. */
export class CloudflareArtifactsClient implements ArtifactsClient {
  constructor(private readonly binding: ArtifactsBinding) {}

  async create(name: string, opts?: { description?: string; readOnly?: boolean; setDefaultBranch?: string }) {
    const r = await this.binding.create(name, opts);
    return { id: r.name, name: r.name, description: opts?.description ?? null, defaultBranch: r.defaultBranch, remote: r.remote, token: r.token };
  }
  async get(name: string) {
    return new BindingRepoHandle(await this.binding.get(name), name);
  }
  async list(opts?: { limit?: number; cursor?: string }) {
    const r = await this.binding.list(opts);
    return {
      repos: r.repos.map((x) => ({ id: x.id ?? x.name, name: x.name, description: x.description ?? null, defaultBranch: x.defaultBranch ?? "main", remote: x.remote })),
      cursor: r.cursor,
    };
  }
  async import(params: { source: { url: string; branch?: string; depth?: number }; target: { name: string; opts?: { description?: string; readOnly?: boolean } } }) {
    const r = await this.binding.import(params);
    return { id: r.name, name: r.name, description: params.target.opts?.description ?? null, defaultBranch: r.defaultBranch ?? "main", remote: r.remote, token: r.token };
  }
  delete(name: string) {
    return this.binding.delete(name);
  }
}
