import { expect, test } from 'bun:test';
import { privateRecoveryRequestSchema } from '../src/server/private-recovery-request';
const legacy = { commit: 'a'.repeat(40), expectedTree: 'b'.repeat(40), idempotencyKey: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
test('recovery boundary preserves legacy omission and exact selected journal/ref/version', () => {
  expect(privateRecoveryRequestSchema.parse(legacy)).toEqual(legacy);
  const bound = { ...legacy, selected: { journalId: 'jrnl_saved', acceptedRef: 'refs/heads/release', acceptedRootVersion: 2 } };
  expect(privateRecoveryRequestSchema.parse(bound)).toEqual(bound);
  expect(privateRecoveryRequestSchema.parse({ ...legacy, selected: { journalId: 'baseline' } })).toEqual({ ...legacy, selected: { journalId: 'baseline' } });
});
test('ambiguous, malformed or client-authored recovery fields fail before dispatch', () => {
  for (const input of [null, [], { ...legacy, selected: {} }, { ...legacy, selected: { journalId: 'saved', acceptedRootVersion: 2 } }, { ...legacy, selected: { journalId: 'saved', acceptedRef: 'refs/heads/release', acceptedRootVersion: '2' } }, { ...legacy, selected: { journalId: 'saved', acceptedRef: 'refs/heads/release', acceptedRootVersion: 0 } }, { ...legacy, selected: { journalId: 'saved', acceptedRef: 'refs/heads/../main' } }, { ...legacy, selected: { journalId: 'saved', accountKey: 'client-account' } }, { ...legacy, acceptedRef: 'refs/heads/release' }, { ...legacy, ownerId: 'client-owner' }]) expect(privateRecoveryRequestSchema.safeParse(input).success).toBe(false);
});
