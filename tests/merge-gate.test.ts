import {expect, test} from 'bun:test';
import {evaluateMergeGate} from '../src/core/merge-gate';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const base = {authorId: 'author', headCommit: HEAD, changedPaths: ['src/app.ts'], requiredApprovals: 1, codeOwners: [], reviews: []};

test('an approval on the current head from another user satisfies a one-approval gate', () => {
  const result = evaluateMergeGate({...base, reviews: [{reviewerId: 'alice', decision: 'approve', commit: HEAD}]});
  expect(result).toEqual({mergeable: true, blockers: [], approvedBy: ['alice']});
});

test('self-approval, approvals for an older head, and duplicate approvals from one reviewer do not count', () => {
  const self = evaluateMergeGate({...base, reviews: [{reviewerId: 'author', decision: 'approve', commit: HEAD}]});
  expect(self.mergeable).toBe(false);
  const stale = evaluateMergeGate({...base, reviews: [{reviewerId: 'alice', decision: 'approve', commit: OLD}]});
  expect(stale.mergeable).toBe(false);
  expect(stale.approvedBy).toEqual([]);
  const duplicate = evaluateMergeGate({...base, requiredApprovals: 2, reviews: [{reviewerId: 'alice', decision: 'approve', commit: HEAD}, {reviewerId: 'alice', decision: 'approve', commit: HEAD}]});
  expect(duplicate.approvedBy).toEqual(['alice']);
  expect(duplicate.mergeable).toBe(false);
});

test('a later request for changes from the same reviewer blocks an earlier approval', () => {
  const result = evaluateMergeGate({...base, reviews: [{reviewerId: 'alice', decision: 'approve', commit: HEAD}, {reviewerId: 'alice', decision: 'request_changes', commit: HEAD}]});
  expect(result.mergeable).toBe(false);
  expect(result.blockers[0]).toBe('Changes were requested by alice');
});

test('a CODEOWNERS path requires an approval from one of its owners, even when the count is met', () => {
  const owners = [{pathPrefix: 'src/', owners: ['security']}];
  const withoutOwner = evaluateMergeGate({...base, codeOwners: owners, reviews: [{reviewerId: 'alice', decision: 'approve', commit: HEAD}]});
  expect(withoutOwner.mergeable).toBe(false);
  expect(withoutOwner.blockers).toEqual(['A code owner approval is required for src/app.ts']);
  const withOwner = evaluateMergeGate({...base, codeOwners: owners, reviews: [{reviewerId: 'security', decision: 'approve', commit: HEAD}]});
  expect(withOwner.mergeable).toBe(true);
});

test('the most specific CODEOWNERS rule decides, and an author cannot satisfy their own code-owner rule', () => {
  const owners = [{pathPrefix: 'src/', owners: ['security']}, {pathPrefix: 'src/billing/', owners: ['finance']}];
  const billing = evaluateMergeGate({...base, changedPaths: ['src/billing/pay.ts'], codeOwners: owners, reviews: [{reviewerId: 'security', decision: 'approve', commit: HEAD}]});
  expect(billing.mergeable).toBe(false);
  const finance = evaluateMergeGate({...base, changedPaths: ['src/billing/pay.ts'], codeOwners: owners, reviews: [{reviewerId: 'finance', decision: 'approve', commit: HEAD}]});
  expect(finance.mergeable).toBe(true);
  const authorOwner = evaluateMergeGate({...base, authorId: 'security', codeOwners: owners, reviews: [{reviewerId: 'security', decision: 'approve', commit: HEAD}]});
  expect(authorOwner.mergeable).toBe(false);
});
