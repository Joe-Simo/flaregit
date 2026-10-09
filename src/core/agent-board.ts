import { z } from "zod";

/** Wire contract for the live multi-agent board. Shared by the repository
 * Durable Object (producer) and the web client (consumer); both sides parse. */

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const path = z.string().min(1).max(500);
const sha = z.string().regex(/^[0-9a-f]{40}$/);

export const AGENT_BOARD_STEPS = ["planning", "proposed", "pushed", "checkpointed"] as const;
export const agentBoardPhaseSchema = z.enum(AGENT_BOARD_STEPS);
export type AgentBoardPhase = z.infer<typeof agentBoardPhaseSchema>;

export const agentBoardAgentSchema = z.object({
  runId: id,
  taskId: id,
  title: z.string().min(1).max(200),
  phase: agentBoardPhaseSchema,
  taskStatus: z.string().min(1).max(40),
  filesTouched: z.array(path).max(200),
  commit: sha.nullable(),
  progress: z.object({
    /** Durable generation of the run on its change (1 = first attempt). */
    round: z.number().int().positive().safe(),
    step: z.number().int().min(1).max(AGENT_BOARD_STEPS.length),
    steps: z.literal(AGENT_BOARD_STEPS.length),
  }).strict(),
  overlapIds: z.array(z.string().min(1).max(1000)).max(200),
  updatedAt: z.string().min(1).max(40),
}).strict();
export type AgentBoardAgent = z.infer<typeof agentBoardAgentSchema>;

/** `same_file`: both branches touch the path (textual overlap).
 * `divergent_content`: both saved proposals replace the path with different
 * content, so a Git three-way merge of the path is likely to conflict.
 * `identical_content`: both proposals converge on the same bytes. */
export const overlapKindSchema = z.enum(["same_file", "divergent_content", "identical_content"]);
export type OverlapKind = z.infer<typeof overlapKindSchema>;

const overlapParty = z.object({ runId: id, taskId: id, title: z.string().min(1).max(200) }).strict();
export const overlapWarningSchema = z.object({
  id: z.string().min(1).max(1000),
  path,
  kind: overlapKindSchema,
  a: overlapParty,
  b: overlapParty,
  detectedAt: z.string().min(1).max(40),
}).strict();
export type OverlapWarning = z.infer<typeof overlapWarningSchema>;

const seq = z.number().int().nonnegative().safe();
export const agentBoardEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), seq, agents: z.array(agentBoardAgentSchema).max(500), overlaps: z.array(overlapWarningSchema).max(2000) }).strict(),
  z.object({ type: z.literal("agent.updated"), seq, agent: agentBoardAgentSchema }).strict(),
  z.object({ type: z.literal("agent.removed"), seq, runId: id }).strict(),
  z.object({ type: z.literal("overlap.added"), seq, overlap: overlapWarningSchema }).strict(),
  z.object({ type: z.literal("overlap.cleared"), seq, id: z.string().min(1).max(1000) }).strict(),
]);
export type AgentBoardEvent = z.infer<typeof agentBoardEventSchema>;

export const agentBoardClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("resync") }).strict(),
]);
export type AgentBoardClientMessage = z.infer<typeof agentBoardClientMessageSchema>;

export const agentBoardTicketSchema = z.object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: z.number().int().positive().safe() }).strict();
export type AgentBoardTicket = z.infer<typeof agentBoardTicketSchema>;

/** Close code sent when a viewer's repository authority is withdrawn. */
export const AGENT_BOARD_ACCESS_CLOSED = 4403;
