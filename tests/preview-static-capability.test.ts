import {expect, test} from 'bun:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertStaticPreviewSource, StaticPreviewNotSupportedError, STATIC_PREVIEW_SUPPORT} from '../src/server/preview-static-capability';
import {buildIsolatedPreview, type IsolatedPreviewBuildLedger} from '../src/server/isolated-preview-build';
import {captureTrustedGitSource} from '../src/server/trusted-git-source';
import type {PreviewExecutionContext} from '../src/server/preview-execution-authority';

test('explicit static capability accepts ordinary root HTML/React entrypoints, not README-only or nested roots', () => {
  const file = (path: string) => ({path, kind: 'file' as const, bytes: new TextEncoder().encode('<main>Ordinary repository</main>')});
  expect(() => assertStaticPreviewSource([file('index.html')])).not.toThrow();
  expect(() => assertStaticPreviewSource([file('index.html'), file('main.tsx')])).not.toThrow();
  expect(() => assertStaticPreviewSource([file('README.md')])).toThrow(StaticPreviewNotSupportedError);
  expect(() => assertStaticPreviewSource([file('site/index.html')])).toThrow(StaticPreviewNotSupportedError);
  expect(STATIC_PREVIEW_SUPPORT.entrypoint).toBe('index.html');
});
test('actual Git README-only source is diagnosed before untrusted funding or dispatch; invocation still closes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'preview-static-source-'));
  const git = (...args: string[]) => {const result = Bun.spawnSync(['git', '-C', dir, ...args]); if (result.exitCode !== 0) throw Error('Owned synthetic Git fixture failed'); return result.stdout;};
  try {
    git('init', '-q'); await Bun.write(join(dir, 'README.md'), 'Owned local preview capability fixture; no hosted evidence.'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'README only');
    const commit = git('rev-parse', 'HEAD').toString().trim(), tree = git('rev-parse', 'HEAD^{tree}').toString().trim();
    const scope = {attemptId: crypto.randomUUID(), projectId: 'p123456789abc', incarnation: crypto.randomUUID(), commit, tree, policyDigest: 'a'.repeat(64)};
    const context: PreviewExecutionContext = {scope, sourceDigest: null, snapshot: {kind: 'preview-execution', projectId: scope.projectId, incarnation: scope.incarnation, commit, tree, policyDigest: scope.policyDigest, actorId: 'owner', accountKey: 'abcdef123456', canonicalRepoName: 'owned-source', providerRepoId: 'owned-provider', target: {kind: 'accepted', receiptId: 'baseline', ref: 'refs/heads/main', version: null}, generation: null, image: `registry.cloudflare.com/${'a'.repeat(32)}/untrusted@sha256:${'b'.repeat(64)}`}};
    const source = await captureTrustedGitSource({scope, provider: {providerRepoId: 'owned-provider', canonicalRepoName: 'owned-source'}, reader: {readObject: async (kind, hash) => git('cat-file', kind, hash)}, authorize: async () => {}});
    let grants = 0, namespaceReads = 0, finishes = 0;
    // RPC doubles only; the source commit/tree/blob bytes above come from real Git.
    const ledger: IsolatedPreviewBuildLedger = {preparePreviewExecution: async () => context, previewExecutionSnapshot: async expected => expected, claimPreviewExecutionInvocation: async (expected, invocationId) => ({status: 'owned', context: expected, invocationId}), finishPreviewExecutionInvocation: async () => {finishes++;}, previewExecutionDispatchState: async () => 'not_dispatched', capturePreviewExecutionSource: async () => source, bindPreviewExecutionSource: async () => {throw Error('Unsupported source must not bind a build grant');}, assertPreviewExecutionSource: async () => {}, preparePreviewExecutionGrant: async () => {grants++;}, authorizePreviewExecution: async () => false, claimPreviewExecutionDispatch: async () => {throw Error('No dispatch');}, sealPreviewExecution: async () => {throw Error('No dispatch to seal');}};
    const namespace = {getByName: () => {namespaceReads++; throw Error('No untrusted native resource');}};
    await expect(buildIsolatedPreview({projectId: scope.projectId, commit, canonicalRepoName: 'owned-source'}, {ledger, namespace})).rejects.toThrow(StaticPreviewNotSupportedError);
    expect(grants).toBe(0); expect(namespaceReads).toBe(0); expect(finishes).toBe(1);
  } finally {await rm(dir, {recursive: true, force: true});}
});
