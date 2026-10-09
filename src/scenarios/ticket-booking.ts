import { RuntimeCodingAgent } from "../agents/runtime-agent.js";
import type { FlareGitRepositoryController, IntegrationOutcome } from "../core/controller.js";
import type { RepairModel } from "../core/pipeline/repair.js";
import type { ProductDecision, Requirement, Task } from "../core/types.js";

const now = () => new Date().toISOString();

function requirement(partial: Pick<Requirement, "id" | "title" | "description"> & Partial<Requirement>): Requirement {
  return { version: 1, status: "approved", originTaskId: "unassigned", approvedAt: now(), assertions: [], ...partial };
}

export interface TaskSpec {
  taskId: string;
  goal: string;
  contributorName: string;
  requirements: Requirement[];
  /** Paths this contributor owns; defaults to all of src/. */
  allowedScope?: string[];
}

export const ACT1: [TaskSpec, TaskSpec] = [
  {
    taskId: "agent-a-discount",
    goal: "Add a 15% group discount to calculateQuote for orders of 4 or more tickets (src/pricing.ts).",
    contributorName: "Agent A (Discount)",
    requirements: [
      requirement({
        id: "REQ-GROUP-DISCOUNT-15",
        title: "15% group discount for 4+ tickets",
        description: "Four $40 tickets cost $136.00 before add-ons.",
        originTaskId: "agent-a-discount",
      }),
    ],
  },
  {
    taskId: "agent-b-refundable",
    goal: "Add an optional refundable-ticket option to calculateQuote with a $5.00 per ticket surcharge and isRefundable flag (src/pricing.ts).",
    contributorName: "Agent B (Refundable)",
    requirements: [
      requirement({
        id: "REQ-REFUNDABLE-SURCHARGE",
        title: "Refundable ticket surcharge",
        description: "Two $40 refundable tickets cost $90.00.",
        originTaskId: "agent-b-refundable",
      }),
    ],
  },
];

export const ACT2: [TaskSpec, TaskSpec] = [
  {
    taskId: "agent-a-cents-migration",
    goal: "Store catalog event prices as integer cents (4000 for $40) in src/catalog.ts.",
    contributorName: "Agent A (Units)",
    allowedScope: ["src/catalog.ts"],
    requirements: [
      requirement({
        id: "REQ-CATALOG-CENTS",
        title: "Catalog prices stored as integer cents",
        description: "Store event prices internally as integer cents to avoid floating point errors.",
        originTaskId: "agent-a-cents-migration",
      }),
    ],
  },
  {
    taskId: "agent-b-receipt-items",
    goal: "Add itemized receiptItems to calculateQuote output whose amounts sum to the quote total (src/pricing.ts).",
    contributorName: "Agent B (Receipts)",
    allowedScope: ["src/pricing.ts"],
    requirements: [
      requirement({
        id: "REQ-RECEIPT-ITEMS",
        title: "Itemized receipt lines",
        description: "Produce receipt line items that sum to the quote total exactly.",
        originTaskId: "agent-b-receipt-items",
      }),
    ],
  },
];

const FOUR_REFUNDABLE = { ticketCount: 4, basePrice: 40, isRefundable: true };
const QUOTE_PROBE = { module: "src/pricing.ts", export: "calculateQuote" };

export const ACT3: [TaskSpec, TaskSpec] = [
  {
    taskId: "agent-a-discount-all",
    goal: "Make the group discount also reduce the refundable surcharge (src/pricing.ts).",
    contributorName: "Agent A (Discount scope)",
    requirements: [
      requirement({
        id: "REQ-DISCOUNT-INCLUDES-REFUND-FEE",
        title: "Group discount applies to the whole order",
        description: "The group discount also reduces the refund fee.",
        originTaskId: "agent-a-discount-all",
        clarifyingQuestion: "Should the group discount apply to the refund fee?",
        policyPatch: { discountAppliesToRefundFee: true },
        assertions: [
          {
            id: "a-total",
            description: "Four $40 refundable tickets cost $153.00 ($180 × 0.85)",
            input: FOUR_REFUNDABLE,
            expectedOutput: { total: 153 },
            probe: QUOTE_PROBE,
          },
        ],
      }),
    ],
  },
  {
    taskId: "agent-b-fixed-refund",
    goal: "Guarantee the refundable surcharge is never discounted (src/pricing.ts).",
    contributorName: "Agent B (Fee protection)",
    requirements: [
      requirement({
        id: "REQ-REFUND-FEE-NEVER-DISCOUNTED",
        title: "Refund fee is never discounted",
        description: "The refund fee is a flat $5.00 per ticket regardless of discounts.",
        originTaskId: "agent-b-fixed-refund",
        clarifyingQuestion: "Should the group discount apply to the refund fee?",
        policyPatch: { discountAppliesToRefundFee: false },
        assertions: [
          {
            id: "b-total",
            description: "Four $40 refundable tickets cost $156.00 ($160 × 0.85 + $20)",
            input: FOUR_REFUNDABLE,
            expectedOutput: { total: 156 },
            probe: QUOTE_PROBE,
          },
        ],
      }),
    ],
  },
];

export interface ScenarioResult {
  tasks: [Task, Task];
  agentCommits: [string, string];
  /** Present when pre-integration analysis ran. */
  detectionSummary?: string;
  integration: IntegrationOutcome;
}

/** Two real runtime agents work concurrently in their own isolated workspaces, then FlareGit lands them. */
export async function runScenario(
  controller: FlareGitRepositoryController,
  specs: [TaskSpec, TaskSpec],
  agentModel: RepairModel,
  protectedPaths: readonly string[]
): Promise<ScenarioResult> {
  const [taskA, taskB] = await Promise.all(
    specs.map((s) =>
      controller.createTask({
        taskId: s.taskId,
        goal: s.goal,
        contributorName: s.contributorName,
        contributorType: "agent",
        requirements: s.requirements,
        allowedScope: s.allowedScope ?? ["src/"],
      })
    )
  ) as [Task, Task];

  const agents = [new RuntimeCodingAgent(taskA, protectedPaths), new RuntimeCodingAgent(taskB, protectedPaths)] as const;
  const agentCommits = (await Promise.all(agents.map((a) => a.work(agentModel)))) as [string, string];

  const readyA = controller.recordTaskCheckpoint({ taskId: taskA.id, isReadyForIntegration: true });
  const readyB = controller.recordTaskCheckpoint({ taskId: taskB.id, isReadyForIntegration: true });

  const detection = await controller.analyzeCompatibility(taskA.id, taskB.id);
  const integration = await controller.runIntegrationPipeline([taskA.id, taskB.id]);
  return { tasks: [readyA, readyB], agentCommits, detectionSummary: detection.summary, integration };
}

export function pendingDecision(controller: FlareGitRepositoryController): ProductDecision | undefined {
  return Object.values(controller.getState().decisions).find((d) => d.status === "pending");
}
