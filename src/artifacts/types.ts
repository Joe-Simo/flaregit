export interface ArtifactsRepoMetadata {
  id: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  remote: string;
  token?: string;
  createdAt?: string;
}

export interface ArtifactsCommit {
  hash: string;
  author: string;
  email: string;
  timestamp: string;
  message: string;
  parents: string[];
}

export interface ArtifactsFileContent {
  text(): Promise<string>;
  type: string;
}

export interface ArtifactsRepoHandle extends AsyncDisposable, Disposable {
  info(): Promise<ArtifactsRepoMetadata>;
  createToken(
    scope?: "read" | "write",
    ttl?: number
  ): Promise<{ plaintext: string; expiresAt: string }>;
  fork(
    name: string,
    opts?: {
      description?: string;
      readOnly?: boolean;
      defaultBranchOnly?: boolean;
    }
  ): Promise<ArtifactsRepoMetadata>;
  log(opts?: {
    ref?: string;
    limit?: number;
    offset?: number;
  }): Promise<ArtifactsCommit[]>;
  readCommit(hash: string): Promise<ArtifactsCommit | null>;
  readFile(args: {
    ref: string;
    path: string;
  }): Promise<ArtifactsFileContent | null>;
  dispose(): Promise<void> | void;
}

export interface ArtifactsClient {
  create(
    name: string,
    opts?: {
      description?: string;
      readOnly?: boolean;
      setDefaultBranch?: string;
    }
  ): Promise<ArtifactsRepoMetadata>;
  get(name: string): Promise<ArtifactsRepoHandle>;
  list(opts?: {
    limit?: number;
    cursor?: string;
  }): Promise<{ repos: ArtifactsRepoMetadata[]; cursor?: string }>;
  import(params: {
    source: { url: string; branch?: string; depth?: number };
    target: { name: string; opts?: { description?: string; readOnly?: boolean } };
  }): Promise<ArtifactsRepoMetadata>;
  delete(name: string): Promise<boolean>;
}
