import { FlareGitRepositoryController } from "../core/controller.js";
import { RuntimeCodingAgent } from "../agents/runtime-agent.js";
import type { ProductDecision, Requirement } from "../core/types.js";

export async function runAct3ContradictoryRequirements(
  controller: FlareGitRepositoryController,
  selectedOptionId: "discount_tickets_only" | "discount_includes_refund" = "discount_tickets_only"
): Promise<{
  decision: ProductDecision;
  resolvedAndAccepted: boolean;
  finalCommit: string;
}> {
  console.log("=== ACT III: INCOMPATIBLE REQUIREMENTS STARTING ===");

  const reqA: Requirement = {
    id: "REQ-DISCOUNT-REDUCES-REFUND",
    title: "Group Discount Reduces Refund Surcharge",
    description: "The group discount must also reduce the refund surcharge.",
    version: 1,
    status: "approved",
    originTaskId: "task-discount-all",
    approvedAt: new Date().toISOString(),
    assertions: [],
  };

  const reqB: Requirement = {
    id: "REQ-REFUND-SURCHARGE-NEVER-DISCOUNTED",
    title: "Refund Surcharge Fixed",
    description: "The refund surcharge must never be discounted.",
    version: 1,
    status: "approved",
    originTaskId: "task-fixed-refund",
    approvedAt: new Date().toISOString(),
    assertions: [],
  };

  const taskA = await controller.createTask({
    taskId: "agent-a-discount-refund",
    goal: "Make group discount reduce the refund surcharge",
    contributorName: "Agent A (Discount Expansion)",
    contributorType: "agent",
    requirements: [reqA],
  });

  const taskB = await controller.createTask({
    taskId: "agent-b-fixed-refund",
    goal: "Ensure refund surcharge is never discounted",
    contributorName: "Agent B (Fee Protection)",
    contributorType: "agent",
    requirements: [reqB],
  });

  const runtimeA = new RuntimeCodingAgent(taskA);
  const runtimeB = new RuntimeCodingAgent(taskB);

  runtimeA.writeFile(
    "docs/proposals/group-discount-refund.md",
    "# Proposal: The group discount must also reduce the refund surcharge.\n"
  );
  runtimeA.commit("Proposal: discount reduces refund surcharge");
  runtimeA.push();

  runtimeB.writeFile(
    "docs/proposals/fixed-refund-fee.md",
    "# Proposal: The refund surcharge must never be discounted.\n"
  );
  runtimeB.commit("Proposal: refund surcharge is fixed");
  runtimeB.push();

  controller.recordTaskCheckpoint({
    taskId: taskA.id,
    isReadyForIntegration: true,
  });
  controller.recordTaskCheckpoint({
    taskId: taskB.id,
    isReadyForIntegration: true,
  });

  // Attempt integration: Contradiction should be caught immediately!
  const initialIntegration = await controller.runIntegrationPipeline([
    taskA.id,
    taskB.id,
  ]);

  if (initialIntegration.success || !initialIntegration.decision) {
    throw new Error("Expected integration to pause for contradictory product decision!");
  }

  const decision = initialIntegration.decision;
  console.log(`[Decision Needed] ${decision.question}`);
  console.log(`[Explanation] ${decision.explanation}`);
  console.log("Options presented to product owner:");
  for (const opt of decision.options) {
    console.log(` - [${opt.id}] ${opt.label} (${opt.concreteExample})`);
  }

  // Last accepted application was preserved!
  const currentState = controller.getState();
  console.log(
    `[Safe State Preserved] Last accepted commit remains: ${currentState.acceptedState.currentCommit.slice(0, 7)}`
  );

  // Now simulate product owner making the decision (e.g. discount_tickets_only)
  console.log(`[Product Owner Action] Selected option: ${selectedOptionId}`);
  const { appliedPolicy } = await controller.resolveProductDecision(
    decision.id,
    selectedOptionId
  );

  // Clear contradictory requirement from Task A or Task B based on decision
  if (selectedOptionId === "discount_tickets_only") {
    reqA.status = "superseded";
    taskA.requirements = [];
  } else {
    reqB.status = "superseded";
    taskB.requirements = [];
  }

  // Re-run integration with resolved policy
  const finalIntegration = await controller.runIntegrationPipeline(
    [taskA.id, taskB.id],
    appliedPolicy
  );

  if (!finalIntegration.success || !finalIntegration.candidate.candidateCommit) {
    throw new Error(`Integration after decision failed: ${finalIntegration.error}`);
  }

  console.log(
    `=== ACT III PASSED! Decision resolved and accepted: ${finalIntegration.candidate.candidateCommit.slice(0, 7)} ===`
  );

  return {
    decision,
    resolvedAndAccepted: true,
    finalCommit: finalIntegration.candidate.candidateCommit,
  };
}
