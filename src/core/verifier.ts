import type { VerificationEvidence } from "./types.js";

export type VerificationPolicy = Record<string, unknown>;

export interface VerifierContext {
  repoDir: string;
  candidateCommit: string;
  expectedBase: string;
  requirementsVersion: number;
  policy: VerificationPolicy;
}

/**
 * A protected verifier is owned by the platform, never by contributors. It must evaluate the
 * exact candidate commit in an isolated workspace and bind its evidence to that commit and tree.
 */
export interface ProtectedVerifier {
  readonly identity: string;
  /** Paths contributors may not modify (verification config, tests, CI, platform metadata). */
  readonly protectedPaths: readonly string[];
  readonly defaultPolicy: VerificationPolicy;
  verify(ctx: VerifierContext): Promise<VerificationEvidence>;
}
