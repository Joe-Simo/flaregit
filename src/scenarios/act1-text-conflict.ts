import { FlareGitRepositoryController } from "../core/controller.js";
import { RuntimeCodingAgent } from "../agents/runtime-agent.js";
import type { Requirement } from "../core/types.js";

export async function runAct1TextConflict(controller: FlareGitRepositoryController): Promise<{
  success: boolean;
  candidateCommit: string;
  acceptanceTimeMs: number;
}> {
  const startTime = performance.now();
  console.log("=== ACT I: TEXT CONFLICT STARTING ===");

  // Requirement for Agent A
  const reqA: Requirement = {
    id: "REQ-GROUP-DISCOUNT-15",
    title: "15% Group Discount for 4+ Tickets",
    description: "Applies a 15% discount to ticket prices when ordering 4 or more tickets.",
    version: 1,
    status: "approved",
    originTaskId: "task-agent-a",
    approvedAt: new Date().toISOString(),
    assertions: [
      {
        id: "ast-group-discount",
        description: "Four $40 tickets cost $136.00 before optional add-ons",
      },
    ],
  };

  // Requirement for Agent B
  const reqB: Requirement = {
    id: "REQ-REFUNDABLE-TICKET-SURCHARGE",
    title: "Refundable Protection Surcharge",
    description: "Adds an optional $5.00 surcharge per ticket for refundable bookings with an active indicator.",
    version: 1,
    status: "approved",
    originTaskId: "task-agent-b",
    approvedAt: new Date().toISOString(),
    assertions: [
      {
        id: "ast-refundable-surcharge",
        description: "Two $40 refundable tickets cost $90.00",
      },
    ],
  };

  // 1. Create two parallel tasks
  const taskA = await controller.createTask({
    taskId: "agent-a-discount",
    goal: "Implement 15% group discount for orders of 4 or more tickets in quote calculation",
    contributorName: "Agent A (Discount)",
    contributorType: "agent",
    requirements: [reqA],
  });

  const taskB = await controller.createTask({
    taskId: "agent-b-refundable",
    goal: "Implement refundable tickets option with $5 per ticket protection surcharge",
    contributorName: "Agent B (Refundable)",
    contributorType: "agent",
    requirements: [reqB],
  });

  // 2. Instantiate runtime agents in their isolated workspaces
  const runtimeA = new RuntimeCodingAgent(taskA);
  const runtimeB = new RuntimeCodingAgent(taskB);

  // 3. Concurrently execute independent edits to src/pricing.ts
  await Promise.all([
    (async () => {
      // Agent A modifies calculateQuote to add group discount
      const pricingA = `
import type { QuoteParams, QuoteResult } from "./types.js";

export function calculateQuote(params: QuoteParams): QuoteResult {
  const ticketCount = Math.max(1, params.ticketCount);
  const basePrice = params.basePrice;
  const rawSubtotal = ticketCount * basePrice;

  // Agent A Feature: 15% group discount for 4+ tickets
  const hasGroupDiscount = ticketCount >= 4;
  const discountAmount = hasGroupDiscount ? rawSubtotal * 0.15 : 0;
  const ticketTotal = rawSubtotal - discountAmount;
  const refundFeeTotal = 0;
  const total = ticketTotal;

  return {
    ticketCount,
    basePrice,
    ticketTotal,
    discountAmount,
    refundFeeTotal,
    total,
    isRefundable: false,
    breakdown: [
      \`\${ticketCount} ticket\${ticketCount > 1 ? "s" : ""} @ $\${basePrice.toFixed(2)} = $\${rawSubtotal.toFixed(2)}\`,
      ...(discountAmount > 0 ? [\`Group Discount (15%): -$\${discountAmount.toFixed(2)}\`] : []),
    ],
  };
}
`.trim();
      runtimeA.writeFile("src/pricing.ts", pricingA + "\n");
      runtimeA.commit("Add 15% group discount for 4+ tickets");
      runtimeA.push();
      controller.recordTaskCheckpoint({
        taskId: taskA.id,
        isReadyForIntegration: true,
      });
    })(),

    (async () => {
      // Agent B modifies calculateQuote to add refundable option
      const pricingB = `
import type { QuoteParams, QuoteResult } from "./types.js";

export function calculateQuote(params: QuoteParams): QuoteResult {
  const ticketCount = Math.max(1, params.ticketCount);
  const basePrice = params.basePrice;
  const ticketTotal = ticketCount * basePrice;
  const discountAmount = 0;

  // Agent B Feature: $5/ticket refundable surcharge
  const isRefundable = Boolean(params.isRefundable);
  const refundFeePerTicket = isRefundable ? 5.0 : 0;
  const refundFeeTotal = ticketCount * refundFeePerTicket;
  const total = ticketTotal + refundFeeTotal;

  return {
    ticketCount,
    basePrice,
    ticketTotal,
    discountAmount,
    refundFeeTotal,
    total,
    isRefundable,
    breakdown: [
      \`\${ticketCount} ticket\${ticketCount > 1 ? "s" : ""} @ $\${basePrice.toFixed(2)} = $\${ticketTotal.toFixed(2)}\`,
      ...(refundFeeTotal > 0 ? [\`Refund Protection: +$\${refundFeeTotal.toFixed(2)}\`] : []),
    ],
  };
}
`.trim();
      runtimeB.writeFile("src/pricing.ts", pricingB + "\n");
      runtimeB.commit("Add refundable tickets option with $5 surcharge");
      runtimeB.push();
      controller.recordTaskCheckpoint({
        taskId: taskB.id,
        isReadyForIntegration: true,
      });
    })(),
  ]);

  // 4. Run early compatibility analysis
  const detection = controller.analyzeCompatibility(taskA.id, taskB.id);
  console.log(`[Detection] ${detection.summary}`);

  // 5. Run Integration Pipeline (native composition -> conflict detected -> bounded repair -> protected verification -> exact acceptance)
  const result = await controller.runIntegrationPipeline([taskA.id, taskB.id]);

  if (!result.success || !result.candidate.candidateCommit) {
    throw new Error(`Act I integration failed: ${result.error}`);
  }

  const acceptanceTimeMs = Math.round(performance.now() - startTime);
  console.log(
    `=== ACT I PASSED! Accepted Commit: ${result.candidate.candidateCommit.slice(0, 7)} in ${acceptanceTimeMs}ms ===`
  );

  return {
    success: true,
    candidateCommit: result.candidate.candidateCommit,
    acceptanceTimeMs,
  };
}
