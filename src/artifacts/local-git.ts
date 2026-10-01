import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import type {
  ArtifactsClient,
  ArtifactsCommit,
  ArtifactsFileContent,
  ArtifactsRepoHandle,
  ArtifactsRepoMetadata,
} from "./types.js";

export class LocalGitArtifactsRepoHandle implements ArtifactsRepoHandle {
  constructor(
    private readonly repoPath: string,
    private readonly repoName: string,
    private readonly baseDir: string,
    private readonly metadata: ArtifactsRepoMetadata
  ) {}

  async info(): Promise<ArtifactsRepoMetadata> {
    return this.metadata;
  }

  async createToken(
    _scope: "read" | "write" = "write",
    ttl: number = 3600
  ): Promise<{ plaintext: string; expiresAt: string }> {
    const hex = Buffer.from(crypto.randomBytes(20)).toString("hex");
    const expiresTimestamp = Math.floor(Date.now() / 1000) + ttl;
    const plaintext = `art_v1_${hex}?expires=${expiresTimestamp}`;
    const expiresAt = new Date(expiresTimestamp * 1000).toISOString();
    return { plaintext, expiresAt };
  }

  async fork(
    name: string,
    opts?: {
      description?: string;
      readOnly?: boolean;
      defaultBranchOnly?: boolean;
    }
  ): Promise<ArtifactsRepoMetadata> {
    const targetPath = path.join(this.baseDir, `${name}.git`);
    if (fs.existsSync(targetPath)) {
      throw new Error(`Repository ${name} already exists`);
    }

    // Clone bare to bare
    const args = ["clone", "--bare", this.repoPath, targetPath];
    if (opts?.defaultBranchOnly) {
      args.splice(2, 0, "--single-branch", "-b", this.metadata.defaultBranch);
    }
    const res = spawnSync("git", args);
    if (res.status !== 0) {
      throw new Error(`Git fork failed: ${res.stderr.toString()}`);
    }

    const tokenRes = await this.createToken("write");
    const forkMeta: ArtifactsRepoMetadata = {
      id: `local_repo_${name}`,
      name,
      description: opts?.description ?? `Fork of ${this.repoName}`,
      defaultBranch: this.metadata.defaultBranch,
      remote: targetPath,
      token: tokenRes.plaintext,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(targetPath, "flaregit-metadata.json"),
      JSON.stringify(forkMeta, null, 2)
    );

    return forkMeta;
  }

  async log(opts?: {
    ref?: string;
    limit?: number;
    offset?: number;
  }): Promise<ArtifactsCommit[]> {
    const ref = opts?.ref ?? "HEAD";
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    // Check if repo has any commits
    const headCheck = spawnSync("git", ["--git-dir", this.repoPath, "rev-parse", "--verify", ref]);
    if (headCheck.status !== 0) {
      return [];
    }

    const format = "%H%x00%an%x00%ae%x00%aI%x00%P%x00%s";
    const res = spawnSync("git", [
      "--git-dir",
      this.repoPath,
      "log",
      `--max-count=${limit}`,
      `--skip=${offset}`,
      `--pretty=format:${format}`,
      ref,
    ]);

    if (res.status !== 0) {
      return [];
    }

    const output = res.stdout.toString().trim();
    if (!output) return [];

    const lines = output.split("\n");
    const commits: ArtifactsCommit[] = [];

    for (const line of lines) {
      const parts = line.split("\0");
      if (parts.length >= 6) {
        commits.push({
          hash: parts[0]!,
          author: parts[1]!,
          email: parts[2]!,
          timestamp: parts[3]!,
          parents: parts[4] ? parts[4].split(" ") : [],
          message: parts[5]!,
        });
      }
    }

    return commits;
  }

  async readCommit(hash: string): Promise<ArtifactsCommit | null> {
    const format = "%H%x00%an%x00%ae%x00%aI%x00%P%x00%s";
    const res = spawnSync("git", [
      "--git-dir",
      this.repoPath,
      "show",
      "-s",
      `--pretty=format:${format}`,
      hash,
    ]);

    if (res.status !== 0) return null;

    const output = res.stdout.toString().trim();
    if (!output) return null;

    const parts = output.split("\0");
    if (parts.length < 6) return null;

    return {
      hash: parts[0]!,
      author: parts[1]!,
      email: parts[2]!,
      timestamp: parts[3]!,
      parents: parts[4] ? parts[4].split(" ") : [],
      message: parts[5]!,
    };
  }

  async readFile(args: {
    ref: string;
    path: string;
  }): Promise<ArtifactsFileContent | null> {
    const res = spawnSync("git", [
      "--git-dir",
      this.repoPath,
      "show",
      `${args.ref}:${args.path}`,
    ]);

    if (res.status !== 0) return null;

    const text = Buffer.from(res.stdout).toString("utf-8");
    return {
      async text() {
        return text;
      },
      type: "text/plain;charset=utf-8",
    };
  }

  dispose(): void {}
  [Symbol.dispose](): void {}
  async [Symbol.asyncDispose](): Promise<void> {}
}

export class LocalGitArtifactsClient implements ArtifactsClient {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.resolve(process.cwd(), ".flaregit-storage", "artifacts");
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async create(
    name: string,
    opts?: {
      description?: string;
      readOnly?: boolean;
      setDefaultBranch?: string;
    }
  ): Promise<ArtifactsRepoMetadata> {
    const repoPath = path.join(this.baseDir, `${name}.git`);
    if (fs.existsSync(repoPath)) {
      throw new Error(`Repository ${name} already exists`);
    }

    const defaultBranch = opts?.setDefaultBranch ?? "main";
    const res = spawnSync("git", ["init", "--bare", "--initial-branch", defaultBranch, repoPath]);
    if (res.status !== 0) {
      throw new Error(`Failed to initialize git repository: ${res.stderr.toString()}`);
    }

    const hex = Buffer.from(crypto.randomBytes(20)).toString("hex");
    const expiresTimestamp = Math.floor(Date.now() / 1000) + 86400;
    const token = `art_v1_${hex}?expires=${expiresTimestamp}`;

    const metadata: ArtifactsRepoMetadata = {
      id: `local_repo_${name}`,
      name,
      description: opts?.description ?? null,
      defaultBranch,
      remote: repoPath,
      token,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(repoPath, "flaregit-metadata.json"),
      JSON.stringify(metadata, null, 2)
    );

    return metadata;
  }

  async get(name: string): Promise<ArtifactsRepoHandle> {
    const repoPath = path.join(this.baseDir, `${name}.git`);
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repository ${name} not found`);
    }

    let metadata: ArtifactsRepoMetadata;
    const metaPath = path.join(repoPath, "flaregit-metadata.json");
    if (fs.existsSync(metaPath)) {
      metadata = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as ArtifactsRepoMetadata;
    } else {
      metadata = {
        id: `local_repo_${name}`,
        name,
        description: null,
        defaultBranch: "main",
        remote: repoPath,
        createdAt: new Date().toISOString(),
      };
    }

    return new LocalGitArtifactsRepoHandle(repoPath, name, this.baseDir, metadata);
  }

  async list(opts?: {
    limit?: number;
    cursor?: string;
  }): Promise<{ repos: ArtifactsRepoMetadata[]; cursor?: string }> {
    const repos: ArtifactsRepoMetadata[] = [];
    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith(".git")) {
        const repoName = entry.name.replace(/\.git$/, "");
        const metaPath = path.join(this.baseDir, entry.name, "flaregit-metadata.json");
        if (fs.existsSync(metaPath)) {
          repos.push(JSON.parse(fs.readFileSync(metaPath, "utf-8")));
        } else {
          repos.push({
            id: `local_repo_${repoName}`,
            name: repoName,
            description: null,
            defaultBranch: "main",
            remote: path.join(this.baseDir, entry.name),
          });
        }
      }
    }

    return { repos: repos.slice(0, opts?.limit ?? 50) };
  }

  async import(params: {
    source: { url: string; branch?: string; depth?: number };
    target: { name: string; opts?: { description?: string; readOnly?: boolean } };
  }): Promise<ArtifactsRepoMetadata> {
    const targetPath = path.join(this.baseDir, `${params.target.name}.git`);
    if (fs.existsSync(targetPath)) {
      throw new Error(`Repository ${params.target.name} already exists`);
    }

    const args = ["clone", "--bare", params.source.url, targetPath];
    if (params.source.branch) {
      args.splice(2, 0, "-b", params.source.branch);
    }
    if (params.source.depth) {
      args.splice(2, 0, "--depth", params.source.depth.toString());
    }

    const res = spawnSync("git", args);
    if (res.status !== 0) {
      throw new Error(`Git import failed: ${res.stderr.toString()}`);
    }

    const tokenHex = Buffer.from(crypto.randomBytes(20)).toString("hex");
    const metadata: ArtifactsRepoMetadata = {
      id: `local_repo_${params.target.name}`,
      name: params.target.name,
      description: params.target.opts?.description ?? `Imported from ${params.source.url}`,
      defaultBranch: params.source.branch ?? "main",
      remote: targetPath,
      token: `art_v1_${tokenHex}?expires=${Math.floor(Date.now() / 1000) + 86400}`,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(targetPath, "flaregit-metadata.json"),
      JSON.stringify(metadata, null, 2)
    );

    return metadata;
  }

  async delete(name: string): Promise<boolean> {
    const repoPath = path.join(this.baseDir, `${name}.git`);
    if (!fs.existsSync(repoPath)) return false;
    fs.rmSync(repoPath, { recursive: true, force: true });
    return true;
  }
}
