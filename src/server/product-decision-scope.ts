import { z } from 'zod';
import { assertCompatibleAcceptedTargetBatch,effectiveTaskAcceptedTarget, type FrozenAcceptedTarget } from '../core/accepted-target';
import type { ProductDecision, ProductDecisionParticipant, ProductDecisionScope, Requirement, Task } from '../core/types';

type Context = { projectId: string; incarnation: string; tasks: Record<string, Task>; writerOf?: (taskId: string) => string | null };
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function participant(task: Task, conflictIds: readonly string[], writerOf?: Context['writerOf']): ProductDecisionParticipant {
  return { taskId: task.id, currentCommit: task.currentCommit, baseCommit: task.baseCommit, workspaceRepoName: task.workspace.repoName, workspaceBranch: task.workspace.branch,
    ...(task.dependsOn ? { dependsOn: task.dependsOn } : {}), ...(task.activeCandidateId ? { activeCandidateId: task.activeCandidateId } : {}),
    ...(task.targetGeneration?{targetGeneration:{eventId:task.targetGeneration.eventId,generation:task.targetGeneration.generation}}:{}),
    ...(task.agentRunId ? { agentRunId: task.agentRunId } : {}), ...(task.agentWorkflowInstanceId ? { agentWorkflowInstanceId: task.agentWorkflowInstanceId } : {}),
    contributorId: task.contributor.id, contributorType: task.contributor.type, ...(task.initiatedBy ? { initiatedById: task.initiatedBy.id } : {}),
    ...(writerOf ? { writerId: writerOf(task.id) } : {}), conflictingRequirements: structuredClone(task.requirements.filter(requirement => conflictIds.includes(requirement.id))) };
}
function targetOf(tasks: Task[], expected?: FrozenAcceptedTarget): FrozenAcceptedTarget | undefined {
  if (!tasks.some(task => task.acceptedTarget !== undefined)) { if (expected) throw Error('Decision target is missing from its participants'); return undefined; }
  if (tasks.some(task => task.acceptedTarget === undefined)) throw Error('Bound and unbound decisions cannot share participants');
  const targets = tasks.map(task => effectiveTaskAcceptedTarget(task)!);
  return assertCompatibleAcceptedTargetBatch(expected ? [expected, ...targets] : targets);
}
/** Trusted caller supplies the exact claim batch, not every waiting repository task. */
export function freezeProductDecisionScope(context: Context, taskIds: readonly string[], conflicts: readonly [Requirement, Requirement], acceptedTarget?: FrozenAcceptedTarget): ProductDecisionScope {
  z.string().min(1).max(128).parse(context.projectId); z.uuid().parse(context.incarnation);
  if (!taskIds.length || taskIds.length > 8 || new Set(taskIds).size !== taskIds.length || conflicts[0].id === conflicts[1].id) throw Error('Exact decision participants and conflicting requirements required');
  const tasks = taskIds.map(id => context.tasks[id]);
  if (tasks.some(task => !task || ['accepted', 'cancelled'].includes(task.status))) throw Error('Decision participant is unavailable');
  const selected = tasks as Task[], ids = conflicts.map(requirement => requirement.id), target = targetOf(selected, acceptedTarget);
  // A conflicting requirement may belong to recorded accepted target history.
  const originals = [...selected.flatMap(task => task.requirements), ...(target?.requirements ?? [])];
  if (conflicts.some(requirement => !originals.some(original => same(original, requirement)))) throw Error('Conflicting requirement provenance is unavailable');
  return { projectId: context.projectId, incarnation: context.incarnation, participants: selected.map(task => participant(task, ids, context.writerOf)), conflictingRequirements: structuredClone([...conflicts] as [Requirement, Requirement]), ...(target ? { acceptedTarget: structuredClone(target) } : {}) };
}
export interface ProductDecisionResolutionPlan { taskIds: string[]; losingRequirementId: string; policyPatch?: Record<string, unknown> }
/** Does not mutate tasks, policies, decision receipts, or original creation targets. */
export function planProductDecisionResolution(decision: ProductDecision, selectedOptionId: string, context: Context): ProductDecisionResolutionPlan {
  if (decision.status !== 'pending' || !decision.conflictingRequirementIds.includes(selectedOptionId)) throw Error('Pending exact product choice required');
  const ids = decision.conflictingRequirementIds;
  let tasks: Task[], requirements: Requirement[];
  if (decision.scope) {
    const scope = decision.scope;
    if (scope.projectId !== context.projectId || scope.incarnation !== context.incarnation || !same(scope.conflictingRequirements.map(requirement => requirement.id), ids)) throw Error('Decision repository or conflict scope changed');
    if (!scope.participants.length || scope.participants.length > 8 || new Set(scope.participants.map(value => value.taskId)).size !== scope.participants.length) throw Error('Saved decision participant scope is unavailable');
    tasks = scope.participants.map(saved => {
      const task = context.tasks[saved.taskId];
      if (!task || !['needs_decision', 'ready'].includes(task.status) || (saved.writerId !== undefined && !context.writerOf)) throw Error('Decision participant stopped or changed ownership');
      const current = participant(task, ids, saved.writerId !== undefined ? context.writerOf : undefined);
      if (!same(current, saved)) throw Error('Decision participant inputs or original requirements changed');
      return task;
    });
    targetOf(tasks, scope.acceptedTarget);
    requirements = scope.conflictingRequirements;
  } else {
    // Legacy decisions have no trustworthy batch list. Do not unlock unrelated
    // waits; only current owners of these exact conflicting requirement IDs.
    tasks = Object.values(context.tasks).filter(task => task.status === 'needs_decision' && task.requirements.some(requirement => ids.includes(requirement.id)));
    if (!tasks.length || tasks.length > 8) throw Error('Legacy conflicting requirement owners are unavailable');
    targetOf(tasks);
    requirements = tasks.flatMap(task => task.requirements).filter(requirement => ids.includes(requirement.id));
    for (const id of ids) {
      const matches = requirements.filter(requirement => requirement.id === id);
      if (!matches.length || matches.some(requirement => !same(requirement, matches[0]))) throw Error('Legacy requirement provenance is ambiguous');
    }
  }
  const selected = requirements.find(requirement => requirement.id === selectedOptionId);
  if (!selected || selected.status !== 'approved') throw Error('Original approved choice is unavailable');
  return { taskIds: tasks.map(task => task.id), losingRequirementId: ids.find(id => id !== selectedOptionId)!, ...(selected.policyPatch ? { policyPatch: structuredClone(selected.policyPatch) } : {}) };
}
