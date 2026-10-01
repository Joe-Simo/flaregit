import { FlareGitRepositoryController } from "../core/controller.js";
import { RuntimeCodingAgent } from "../agents/runtime-agent.js";
import type { Requirement } from "../core/types.js";

export async function runAct2CleanMergeBrokenBehavior(
  controller: FlareGitRepositoryController
): Promise<{
  success: boolean;
  candidateCommit: string;
  acceptanceTimeMs: number;
}> {
  const startTime = performance.now();
  console.log("=== ACT II: CLEAN MERGE, BROKEN BEHAVIOR STARTING ===");

  const reqA: Requirement = {
    id: "REQ-CATALOG-CENTS-REPRESENTATION",
    title: "Catalog Integer Cents Storage",
    description: "Store event prices internally as integer cents to avoid floating point issues.",
    version: 1,
    status: "approved",
    originTaskId: "task-cents-migration",
    approvedAt: new Date().toISOString(),
    assertions: [],
  };

  const reqB: Requirement = {
    id: "REQ-RECEIPT-ITEMIZED-LINES",
    title: "Receipt Itemized Line Items",
    description: "Produce itemized receipt line items matching quote total exactly.",
    version: 1,
    status: "approved",
    originTaskId: "task-receipt-items",
    approvedAt: new Date().toISOString(),
    assertions: [],
  };

  // 1. Create two parallel tasks from current accepted HEAD (which has Act I features)
  const taskA = await controller.createTask({
    taskId: "agent-a-cents-migration",
    goal: "Store catalog prices in integer cents (e.g. 4000 cents for $40)",
    contributorName: "Agent A (Units Specialist)",
    contributorType: "agent",
    requirements: [reqA],
  });

  const taskB = await controller.createTask({
    taskId: "agent-b-receipt-items",
    goal: "Add itemized receipt lines to calculateQuote output",
    contributorName: "Agent B (Receipt Specialist)",
    contributorType: "agent",
    requirements: [reqB],
  });

  const runtimeA = new RuntimeCodingAgent(taskA);
  const runtimeB = new RuntimeCodingAgent(taskB);

  // 2. Concurrently execute disjoint edits:
  // Agent A edits src/catalog.ts
  // Agent B edits src/pricing.ts
  await Promise.all([
    (async () => {
      const centsCatalog = `
import type { EventItem } from "./types.js";

export const EVENT_CATALOG: EventItem[] = [
  {
    id: "cf-connect-2026",
    name: "Cloudflare Connect 2026",
    venue: "Moscone West, San Francisco",
    date: "October 21, 2026",
    price: 4000, // Stored in integer cents!
  },
  {
    id: "edge-agent-summit",
    name: "Agentic Systems Summit",
    venue: "Austin Convention Center",
    date: "November 14, 2026",
    price: 5000,
  },
];

export function getEvent(id: string): EventItem {
  const event = EVENT_CATALOG.find((e) => e.id === id);
  if (!event) throw new Error(\`Event not found: \${id}\`);
  return event;
}
`.trim();
      runtimeA.writeFile("src/catalog.ts", centsCatalog + "\n");
      runtimeA.commit("Change catalog pricing storage to integer cents");
      runtimeA.push();
      controller.recordTaskCheckpoint({
        taskId: taskA.id,
        isReadyForIntegration: true,
      });
    })(),

    (async () => {
      // Agent B adds receipt line items against starting dollar assumption
      const currentPricing = runtimeB.readFile("src/pricing.ts");
      const updatedPricing = currentPricing.replace(
        "return {",
        `
  const receiptItems = [
    { description: \`\${ticketCount}x Standard Ticket\`, amount: rawSubtotal },
    ...(discountAmount > 0 ? [{ description: "Group Discount (15%)", amount: -discountAmount, isDiscount: true }] : []),
    ...(refundFeeTotal > 0 ? [{ description: "Refundable Protection Surcharge", amount: refundFeeTotal }] : []),
  ];

  return {
    receiptItems,
`
      );
      runtimeB.writeFile("src/pricing.ts", updatedPricing);
      runtimeB.commit("Add itemized receipt lines to quote calculation");
      runtimeB.push();
      controller.recordTaskCheckpoint({
        taskId: taskB.id,
        isReadyForIntegration: true,
      });
    })(),
  ]);

  // 3. Compatibility detection: files do not overlap, but contract analysis flags unit mismatch
  const detection = controller.analyzeCompatibility(taskA.id, taskB.id);
  console.log(`[Detection] ${detection.summary}`);

  // 4. Run integration pipeline:
  // - Native Git merge succeeds cleanly!
  // - Protected verification runs: REQ-CATALOG-UNITS-CONTRACT FAILS!
  // - Automatic behavioral repair triggers, normalizes units contract
  // - Protected verification passes
  // - Exact commit is published
  const result = await controller.runIntegrationPipeline([taskA.id, taskB.id]);

  if (!result.success || !result.candidate.candidateCommit) {
    throw new Error(`Act II integration failed: ${result.error}`);
  }

  const acceptanceTimeMs = Math.round(performance.now() - startTime);
  console.log(
    `=== ACT II PASSED! Clean merge behavioral failure repaired and accepted: ${result.candidate.candidateCommit.slice(0, 7)} in ${acceptanceTimeMs}ms ===`
  );

  return {
    success: true,
    candidateCommit: result.candidate.candidateCommit,
    acceptanceTimeMs,
  };
}
