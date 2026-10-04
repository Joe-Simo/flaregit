import { expect, test } from 'bun:test';
import { freezeProductDecisionScope, planProductDecisionResolution } from '../src/server/product-decision-scope';
import type { ProductDecision, Requirement, Task } from '../src/core/types';
import type { FrozenAcceptedTarget } from '../src/core/accepted-target';
const base = 'a'.repeat(40);
function requirement(id: string, taskId: string, patch?: Record<string, unknown>): Requirement {
  return { id, title: id, description: `Choice ${id}`, version: 1, status: 'approved', assertions: [], originTaskId: taskId, approvedAt: '2026-10-04', ...(patch ? { policyPatch: patch } : {}) };
}
function task(id: string, requirements: Requirement[], target?: FrozenAcceptedTarget): Task {
  return { id, goal: id, contributor: { id: `author-${id}`, name: id, type: 'human' }, baseCommit: base, currentCommit: base, status: 'ready', allowedScope: ['src/'], requirements, workspace: { repoName: `workspace-${id}`, remote: 'https://fixture.invalid/git', branch: `task/${id}` }, checkpoints: [], createdAt: 'now', updatedAt: 'now', ...(target ? { acceptedTarget: target } : {}) };
}
function fixture(bound = false) {
  const incarnation = crypto.randomUUID();
  const target: FrozenAcceptedTarget = { projectId: 'project', incarnation, canonicalRepoName: 'canonical', ref: 'refs/heads/release', branch: 'release', acceptedCommit: base, acceptedVersion: 0, requirements: [], policyVersion: 1, policy: {} };
  const a = requirement('choice-a', 'a', { refunds: true }), b = requirement('choice-b', 'b');
  const tasks = { a: task('a', [a], bound ? target : undefined), b: task('b', [b], bound ? target : undefined), other: task('other', [requirement('other-choice', 'other')], bound ? { ...target, ref: 'refs/heads/feature', branch: 'feature' } : undefined) };
  const writers: Record<string, string | null> = { a: 'writer-a', b: 'writer-b', other: 'writer-other' };
  const context = { projectId: 'project', incarnation, tasks, writerOf: (id: string) => writers[id] ?? null };
  const scope = freezeProductDecisionScope(context, ['a', 'b'], [a, b], bound ? target : undefined);
  const decision: ProductDecision = { id: 'decision', question: 'Choose', explanation: 'Conflicting choices', conflictingRequirementIds: ['choice-a', 'choice-b'], options: [{ id: 'choice-a', label: 'A', description: 'A', concreteExample: 'A' }, { id: 'choice-b', label: 'B', description: 'B', concreteExample: 'B' }], status: 'pending', createdAt: 'now', scope };
  tasks.a.status = tasks.b.status = tasks.other.status = 'needs_decision';
  return { context, tasks, writers, decision, target };
}
test('scoped decision resolves only its frozen group, preserves a different branch wait, and returns one immutable policy patch', () => {
  const f = fixture(true), before = JSON.stringify(f);
  const plan = planProductDecisionResolution(f.decision, 'choice-a', f.context);
  expect(plan).toEqual({ taskIds: ['a', 'b'], losingRequirementId: 'choice-b', policyPatch: { refunds: true } });
  expect(JSON.stringify(f)).toBe(before); expect(f.tasks.other.status).toBe('needs_decision');
  plan.policyPatch!.refunds = false;
  expect(f.tasks.a.requirements[0]!.policyPatch).toEqual({ refunds: true });
  expect(f.decision.scope!.acceptedTarget).toEqual(f.target);
});
test('changed original inputs, authority, target, cancelled or accepted participants reject the whole choice', () => {
  const mutations: Array<(f: ReturnType<typeof fixture>) => void> = [
    f => { f.tasks.a.status = 'cancelled'; }, f => { f.tasks.a.status = 'accepted'; },
    f => { f.tasks.a.currentCommit = 'b'.repeat(40); }, f => { f.tasks.a.baseCommit = 'c'.repeat(40); },
    f => { f.tasks.a.requirements[0]!.description = 'Changed original'; }, f => { f.writers.a = 'new-writer'; },
    f => { f.tasks.a.activeCandidateId = 'new-owner'; }, f => { f.tasks.a.agentRunId = 'new-agent-generation'; },
    f => { f.tasks.a = { ...f.tasks.a, acceptedTarget: { ...f.target, ref: 'refs/heads/feature', branch: 'feature' } }; },
    f => { f.context.incarnation = crypto.randomUUID(); }, f => { f.context.projectId = 'another-project'; },
  ];
  for (const mutate of mutations) { const f = fixture(true); mutate(f); expect(() => planProductDecisionResolution(f.decision, 'choice-a', f.context)).toThrow(); }
});
test('legacy fallback considers conflicting requirement owners rather than every pending group', () => {
  const f = fixture(), { scope: _scope, ...legacy } = f.decision;
  expect(planProductDecisionResolution(legacy, 'choice-b', f.context)).toEqual({ taskIds: ['a', 'b'], losingRequirementId: 'choice-a' });
  expect(f.tasks.other.status).toBe('needs_decision');
  f.tasks.a.status = 'cancelled'; expect(() => planProductDecisionResolution(legacy, 'choice-a', f.context)).toThrow('provenance');
});
test('freezing a decision refuses mixed branch or bound/unbound groups and captures nonconflicting members of the exact batch', () => {
  const f = fixture(true);
  expect(() => freezeProductDecisionScope(f.context, ['a', 'other'], [f.tasks.a.requirements[0]!, f.tasks.other.requirements[0]!])).toThrow();
  const unbound = task('unbound', [requirement('unbound-choice', 'unbound')]);
  expect(() => freezeProductDecisionScope({ ...f.context, tasks: { ...f.tasks, unbound } }, ['a', 'unbound'], [f.tasks.a.requirements[0]!, unbound.requirements[0]!])).toThrow();
  const extra = task('extra', [], f.target), context = { ...f.context, tasks: { ...f.tasks, extra } };
  const scope = freezeProductDecisionScope(context, ['a', 'b', 'extra'], [f.tasks.a.requirements[0]!, f.tasks.b.requirements[0]!], f.target);
  expect(planProductDecisionResolution({ ...f.decision, scope }, 'choice-a', context).taskIds).toEqual(['a', 'b', 'extra']);
});
