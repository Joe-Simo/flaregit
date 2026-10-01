import * as fs from "node:fs";
import * as path from "node:path";
import type { VerificationEvidence, PublicationJournalEntry } from "../core/types.js";

export interface EvidenceStorage {
  putEvidence(evidence: VerificationEvidence): Promise<string>;
  getEvidence(evidenceId: string): Promise<VerificationEvidence | null>;
  putJournalEntry(entry: PublicationJournalEntry): Promise<void>;
  putBuildArtifact(commitHash: string, filename: string, content: Buffer | string): Promise<string>;
}

export class CloudflareR2EvidenceStorage implements EvidenceStorage {
  private bucket: any; // Cloudflare R2Bucket binding

  constructor(bucket: any) {
    this.bucket = bucket;
  }

  async putEvidence(evidence: VerificationEvidence): Promise<string> {
    const key = `evidence/${evidence.id}.json`;
    await this.bucket.put(key, JSON.stringify(evidence, null, 2), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        candidateCommit: evidence.candidateCommit,
        status: evidence.status,
      },
    });
    return key;
  }

  async getEvidence(evidenceId: string): Promise<VerificationEvidence | null> {
    const key = `evidence/${evidenceId}.json`;
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    const text = await obj.text();
    return JSON.parse(text) as VerificationEvidence;
  }

  async putJournalEntry(entry: PublicationJournalEntry): Promise<void> {
    const key = `journal/${entry.id}.json`;
    await this.bucket.put(key, JSON.stringify(entry, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });
  }

  async putBuildArtifact(commitHash: string, filename: string, content: Buffer | string): Promise<string> {
    const key = `artifacts/${commitHash}/${filename}`;
    await this.bucket.put(key, content);
    return key;
  }
}

export class LocalEvidenceStorage implements EvidenceStorage {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.resolve(process.cwd(), ".flaregit-storage", "evidence");
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async putEvidence(evidence: VerificationEvidence): Promise<string> {
    const filePath = path.join(this.baseDir, `${evidence.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(evidence, null, 2));
    return filePath;
  }

  async getEvidence(evidenceId: string): Promise<VerificationEvidence | null> {
    const filePath = path.join(this.baseDir, `${evidenceId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as VerificationEvidence;
  }

  async putJournalEntry(entry: PublicationJournalEntry): Promise<void> {
    const journalDir = path.join(this.baseDir, "journal");
    if (!fs.existsSync(journalDir)) fs.mkdirSync(journalDir, { recursive: true });
    fs.writeFileSync(path.join(journalDir, `${entry.id}.json`), JSON.stringify(entry, null, 2));
  }

  async putBuildArtifact(commitHash: string, filename: string, content: Buffer | string): Promise<string> {
    const artDir = path.join(this.baseDir, "artifacts", commitHash);
    if (!fs.existsSync(artDir)) fs.mkdirSync(artDir, { recursive: true });
    const target = path.join(artDir, filename);
    fs.writeFileSync(target, content);
    return target;
  }
}
