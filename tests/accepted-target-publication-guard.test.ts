import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gitOrThrow, PLATFORM_IDENTITY } from '../src/core/pipeline/git';
import { publishAcceptedCandidate } from '../src/core/pipeline/accept';
import type { CandidateGeneration, VerificationEvidence, PublicationJournalEntry } from '../src/core/types';
import type { FrozenAcceptedTarget } from '../src/core/accepted-target';

test('explicit target refuses compatibility publication before transferring objects or changing either real Git branch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flaregit-target-publication-'));
  const work = join(root, 'work'), canonical = join(root, 'canonical.git');
  try {
    await mkdir(work); gitOrThrow(work, ['init', '-b', 'main']);
    await Bun.write(join(work, 'source.txt'), 'Accepted local fixture\n');
    gitOrThrow(work, ['add', '.']); gitOrThrow(work, [...PLATFORM_IDENTITY, 'commit', '-m', 'Accepted local fixture']);
    const base = gitOrThrow(work, ['rev-parse', 'HEAD']);
    gitOrThrow(root, ['init', '--bare', canonical]);
    gitOrThrow(work, ['push', canonical, `${base}:refs/heads/main`, `${base}:refs/heads/release`]);
    await Bun.write(join(work, 'source.txt'), 'Reviewed local contribution\n');
    gitOrThrow(work, ['add', '.']); gitOrThrow(work, [...PLATFORM_IDENTITY, 'commit', '-m', 'Reviewed local contribution']);
    const commit = gitOrThrow(work, ['rev-parse', 'HEAD']), tree = gitOrThrow(work, ['rev-parse', 'HEAD^{tree}']);
    const candidate: CandidateGeneration = { id: 'target-fixture', attemptNumber: 1, participatingTaskIds: ['task'], participatingCommits: { task: commit }, expectedAcceptedBase: base, frozenPolicyVersion: 1, frozenVerificationPolicy: {}, frozenRequirements: [], candidateCommit: commit, repairAttempts: [], status: 'verified', createdAt: 'now', updatedAt: 'now' };
    const evidence: VerificationEvidence = { id: 'fixture-proof', candidateCommit: commit, candidateTree: tree, expectedAcceptedBase: base, requirementsVersion: 1, policy: {}, testBundleDigest: 'fixture', toolchainDigest: 'fixture', builtOutputDigest: 'fixture', verifierIdentity: 'local-fixture', testResults: [], timestamp: 'now', status: 'passed' };
    const target: FrozenAcceptedTarget = { projectId: 'fixture', incarnation: crypto.randomUUID(), canonicalRepoName: 'canonical', ref: 'refs/heads/release', branch: 'release', acceptedCommit: base, acceptedVersion: 0, requirements: [], policyVersion: 1, policy: {} };
    const candidateRef = 'refs/flaregit/candidates/target-fixture';
    gitOrThrow(work, ['update-ref', candidateRef, commit]);
    const refsBefore = gitOrThrow(canonical, ['show-ref'], { gitDir: true });
    for (const binding of ['candidate', 'evidence'] as const) {
      const journal: PublicationJournalEntry[] = [];
      const result = publishAcceptedCandidate({ canonicalRepoDir: canonical, defaultBranch: binding === 'candidate' ? 'main' : 'release', candidate: binding === 'candidate' ? { ...candidate, acceptedTarget: target } : candidate, evidence: binding === 'evidence' ? { ...evidence, acceptedTarget: target } : evidence, candidateRepoDir: work, candidateRef, onJournal: entry => journal.push(entry) });
      expect(result.success).toBe(false); expect(result.error).toContain('target-aware publisher');
      expect(journal.map(entry => entry.state)).toEqual(['ABORTED']); expect(result.acceptanceRecord).toBeUndefined();
      expect(gitOrThrow(canonical, ['show-ref'], { gitDir: true })).toBe(refsBefore);
      if (binding === 'candidate') expect(journal[0]!.acceptedTarget).toEqual(target);
    }
    // Legacy primary compatibility remains usable; only the unsupported target
    // path is fenced. This is real local Git evidence, not hosted acceptance.
    const legacy = publishAcceptedCandidate({ canonicalRepoDir: canonical, defaultBranch: 'main', candidate, evidence, candidateRepoDir: work, candidateRef });
    expect(legacy.success).toBe(true);
    expect(gitOrThrow(canonical, ['rev-parse', 'refs/heads/main'], { gitDir: true })).toBe(commit);
    expect(gitOrThrow(canonical, ['rev-parse', 'refs/heads/release'], { gitDir: true })).toBe(base);
  } finally { await rm(root, { recursive: true, force: true }); }
});
