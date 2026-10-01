import type {
  ArtifactsClient,
  ArtifactsCommit,
  ArtifactsFileContent,
  ArtifactsRepoHandle,
  ArtifactsRepoMetadata,
} from "./types.js";

export class CloudflareRestArtifactsRepoHandle implements ArtifactsRepoHandle {
  constructor(
    private readonly accountId: string,
    private readonly namespace: string,
    private readonly repoName: string,
    private readonly apiToken: string,
    private metadata: ArtifactsRepoMetadata
  ) {}

  private get baseUrl(): string {
    return `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/artifacts/namespaces/${this.namespace}`;
  }

  async info(): Promise<ArtifactsRepoMetadata> {
    const res = await fetch(`${this.baseUrl}/repos/${this.repoName}`, {
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok) {
      throw new Error(`Cloudflare Artifacts info failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { result: { id: string; name: string; default_branch: string; remote: string; description: string | null } };
    this.metadata = {
      id: data.result.id,
      name: data.result.name,
      defaultBranch: data.result.default_branch,
      remote: data.result.remote,
      description: data.result.description,
    };
    return this.metadata;
  }

  async createToken(
    scope: "read" | "write" = "write",
    ttl: number = 3600
  ): Promise<{ plaintext: string; expiresAt: string }> {
    const res = await fetch(`${this.baseUrl}/tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repo: this.repoName,
        scope,
        ttl,
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to create repo token: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { result: { plaintext: string; expires_at: string } };
    return {
      plaintext: data.result.plaintext,
      expiresAt: data.result.expires_at,
    };
  }

  async fork(
    name: string,
    opts?: {
      description?: string;
      readOnly?: boolean;
      defaultBranchOnly?: boolean;
    }
  ): Promise<ArtifactsRepoMetadata> {
    const res = await fetch(`${this.baseUrl}/repos/${this.repoName}/fork`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        description: opts?.description,
        read_only: opts?.readOnly,
        default_branch_only: opts?.defaultBranchOnly,
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to fork repo: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { result: { id: string; name: string; default_branch: string; remote: string; token: string; description: string | null } };
    return {
      id: data.result.id,
      name: data.result.name,
      defaultBranch: data.result.default_branch,
      remote: data.result.remote,
      token: data.result.token,
      description: data.result.description,
    };
  }

  async log(opts?: {
    ref?: string;
    limit?: number;
    offset?: number;
  }): Promise<ArtifactsCommit[]> {
    const params = new URLSearchParams();
    if (opts?.ref) params.set("ref", opts.ref);
    if (opts?.limit) params.set("limit", opts.limit.toString());
    if (opts?.offset) params.set("offset", opts.offset.toString());

    const res = await fetch(`${this.baseUrl}/repos/${this.repoName}/log?${params.toString()}`, {
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to read log: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      result: Array<{
        hash: string;
        author: { name: string; email: string };
        date: string;
        message: string;
        parents: string[];
      }>;
    };
    return (data.result || []).map((c) => ({
      hash: c.hash,
      author: c.author?.name || "unknown",
      email: c.author?.email || "unknown",
      timestamp: c.date,
      message: c.message,
      parents: c.parents || [],
    }));
  }

  async readCommit(hash: string): Promise<ArtifactsCommit | null> {
    const res = await fetch(`${this.baseUrl}/repos/${this.repoName}/commit/${hash}`, {
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Failed to read commit: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      result: {
        hash: string;
        author: { name: string; email: string };
        date: string;
        message: string;
        parents: string[];
      };
    };
    return {
      hash: data.result.hash,
      author: data.result.author?.name || "unknown",
      email: data.result.author?.email || "unknown",
      timestamp: data.result.date,
      message: data.result.message,
      parents: data.result.parents || [],
    };
  }

  async readFile(args: {
    ref: string;
    path: string;
  }): Promise<ArtifactsFileContent | null> {
    const params = new URLSearchParams({
      ref: args.ref,
      path: args.path,
    });
    const res = await fetch(`${this.baseUrl}/repos/${this.repoName}/file?${params.toString()}`, {
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Failed to read file: ${res.status} ${await res.text()}`);
    }
    const text = await res.text();
    return {
      async text() {
        return text;
      },
      type: res.headers.get("content-type") || "text/plain;charset=utf-8",
    };
  }

  dispose(): void {}
  [Symbol.dispose](): void {}
  async [Symbol.asyncDispose](): Promise<void> {}
}

export class CloudflareArtifactsClient implements ArtifactsClient {
  constructor(
    private readonly accountId: string,
    private readonly namespace: string,
    private readonly apiToken: string
  ) {}

  private get baseUrl(): string {
    return `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/artifacts/namespaces/${this.namespace}`;
  }

  async create(
    name: string,
    opts?: {
      description?: string;
      readOnly?: boolean;
      setDefaultBranch?: string;
    }
  ): Promise<ArtifactsRepoMetadata> {
    const res = await fetch(`${this.baseUrl}/repos`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        description: opts?.description,
        default_branch: opts?.setDefaultBranch ?? "main",
        read_only: opts?.readOnly ?? false,
      }),
    });
    if (!res.ok) {
      throw new Error(`Cloudflare Artifacts create failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      result: {
        id: string;
        name: string;
        default_branch: string;
        remote: string;
        token: string;
        description: string | null;
      };
    };
    return {
      id: data.result.id,
      name: data.result.name,
      defaultBranch: data.result.default_branch,
      remote: data.result.remote,
      token: data.result.token,
      description: data.result.description,
    };
  }

  async get(name: string): Promise<ArtifactsRepoHandle> {
    const res = await fetch(`${this.baseUrl}/repos/${name}`, {
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok) {
      throw new Error(`Repository ${name} not found: ${res.status}`);
    }
    const data = (await res.json()) as {
      result: {
        id: string;
        name: string;
        default_branch: string;
        remote: string;
        description: string | null;
      };
    };
    const meta: ArtifactsRepoMetadata = {
      id: data.result.id,
      name: data.result.name,
      defaultBranch: data.result.default_branch,
      remote: data.result.remote,
      description: data.result.description,
    };
    return new CloudflareRestArtifactsRepoHandle(
      this.accountId,
      this.namespace,
      name,
      this.apiToken,
      meta
    );
  }

  async list(opts?: {
    limit?: number;
    cursor?: string;
  }): Promise<{ repos: ArtifactsRepoMetadata[]; cursor?: string }> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", opts.limit.toString());
    if (opts?.cursor) params.set("cursor", opts.cursor);

    const res = await fetch(`${this.baseUrl}/repos?${params.toString()}`, {
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to list repos: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      result: Array<{
        id: string;
        name: string;
        default_branch: string;
        remote: string;
        description: string | null;
      }>;
      result_info?: { cursor?: string };
    };
    return {
      repos: (data.result || []).map((r) => ({
        id: r.id,
        name: r.name,
        defaultBranch: r.default_branch,
        remote: r.remote,
        description: r.description,
      })),
      cursor: data.result_info?.cursor,
    };
  }

  async import(params: {
    source: { url: string; branch?: string; depth?: number };
    target: { name: string; opts?: { description?: string; readOnly?: boolean } };
  }): Promise<ArtifactsRepoMetadata> {
    const res = await fetch(`${this.baseUrl}/repos/${params.target.name}/import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: params.source.url,
        branch: params.source.branch,
        depth: params.source.depth,
        read_only: params.target.opts?.readOnly,
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to import repo: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      result: {
        id: string;
        name: string;
        default_branch: string;
        remote: string;
        token: string;
        description: string | null;
      };
    };
    return {
      id: data.result.id,
      name: data.result.name,
      defaultBranch: data.result.default_branch,
      remote: data.result.remote,
      token: data.result.token,
      description: data.result.description,
    };
  }

  async delete(name: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/repos/${name}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    return res.ok;
  }
}
