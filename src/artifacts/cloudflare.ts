import type {
  ArtifactsClient,
  ArtifactsCommit,
  ArtifactsFileContent,
  ArtifactsRepoHandle,
  ArtifactsRepoMetadata,
} from "./types.js";

/** Cloudflare's installed binding declarations match the documented Workers RPC surface.
 * https://developers.cloudflare.com/artifacts/api/workers-binding/
 */
export type ArtifactsBinding = Artifacts;
export type ArtifactsRepoCapability = ArtifactsRepo;

const toCommit = (c: ArtifactsCommitMetadata): ArtifactsCommit => ({
  hash: c.hash,
  author: c.author.name,
  email: c.author.email,
  timestamp: new Date(c.authoredAt * 1000).toISOString(),
  message: c.message,
  parents: c.parents,
});

class BindingRepoHandle implements ArtifactsRepoHandle {
  constructor(private readonly repo: ArtifactsRepoCapability) {}

  async info(): Promise<ArtifactsRepoMetadata> {
    const i = await this.repo.info();
    return { id: i.id, name: i.name, description: i.description ?? null, defaultBranch: i.defaultBranch, remote: i.remote };
  }
  createToken(scope: "read" | "write" = "write", ttl = 3600) {
    return this.repo.createToken(scope, ttl).then((t) => ({
      plaintext: t.plaintext,
      expiresAt: t.expiresAt,
    }));
  }
  async fork(name: string, opts?: { description?: string; readOnly?: boolean; defaultBranchOnly?: boolean }) {
    const f = await this.repo.fork(name, opts);
    return { id: f.id, name: f.name, description: opts?.description ?? null, defaultBranch: f.defaultBranch, remote: f.remote, token: f.token };
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
  dispose(): void { this.repo[Symbol.dispose](); }
  [Symbol.dispose](): void { this.dispose(); }
  async [Symbol.asyncDispose](): Promise<void> { this.dispose(); }
}

/** ArtifactsClient backed by the documented `env.ARTIFACTS` Workers binding. */
export class CloudflareArtifactsClient implements ArtifactsClient {
  constructor(private readonly binding: ArtifactsBinding) {}

  async create(name: string, opts?: { description?: string; readOnly?: boolean; setDefaultBranch?: string }) {
    const r = await this.binding.create(name, opts);
    return { id: r.id, name: r.name, description: opts?.description ?? null, defaultBranch: r.defaultBranch, remote: r.remote, token: r.token };
  }
  async get(name: string) {
    return new BindingRepoHandle(await this.binding.get(name));
  }
  async list(opts?: { limit?: number; cursor?: string }) {
    const r = await this.binding.list(opts);
    return {
      // Namespace list metadata excludes the Git remote. Obtain it from the capability
      // rather than returning undefined under a string type.
      repos: await Promise.all(r.repos.map(async (x) => {
        using repo = await this.binding.get(x.name);
        const info = await repo.info();
        return { id: info.id, name: info.name, description: info.description, defaultBranch: info.defaultBranch, remote: info.remote };
      })),
      cursor: r.cursor,
    };
  }
  async import(params: { source: { url: string; branch?: string; depth?: number }; target: { name: string; opts?: { description?: string; readOnly?: boolean } } }) {
    const r = await this.binding.import(params);
    return { id: r.id, name: r.name, description: params.target.opts?.description ?? null, defaultBranch: r.defaultBranch, remote: r.remote, token: r.token };
  }
  delete(name: string) {
    return this.binding.delete(name);
  }
}
