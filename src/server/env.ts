import type { ArtifactsBinding } from "../artifacts/cloudflare.js";
import type { AiBinding } from "../ai/workers-ai.js";

export interface Env {
  REPOSITORY_CONTROLLER: DurableObjectNamespace;
  INTEGRATOR: DurableObjectNamespace<import("./integrator.js").IntegratorSandbox>;
  AGENT: DurableObjectNamespace<import("./integrator.js").AgentSandbox>;
  SCENARIO_WORKFLOW: Workflow;
  AGENT_WORKFLOW: Workflow;
  INTEGRATION_WORKFLOW: Workflow;
  INTEGRATION_QUEUE: Queue<QueueMessage>;
  EVIDENCE_BUCKET: R2Bucket;
  ARTIFACTS: ArtifactsBinding;
  AI: AiBinding;
  ASSETS: Fetcher;
  /** HMAC key for preview capability links (secret). */
  PREVIEW_SIGNING_KEY?: string;
  /** Per-user API rate limit (Workers Rate Limiting binding). */
  API_LIMITER: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  /** Clerk frontend API URL (the JWT issuer), e.g. https://example.clerk.accounts.dev (var). */
  CLERK_ISSUER?: string;
  /** Comma-separated origins allowed to mint session tokens (`azp`), e.g. https://flaregit.com (var). */
  CLERK_AUTHORIZED_PARTIES?: string;
  /** Clerk publishable key; public by design, served to the SPA via /api/config-free endpoint (var). */
  CLERK_PUBLISHABLE_KEY?: string;
  /** Dedicated origin serving previews (e.g. https://preview.flaregit.com), isolated from the app origin. */
  PREVIEW_ORIGIN: string;
  AI_GATEWAY_ID?: string;
  /** Daily model-backed run allowance per plan (spend control). */
  /** Platform-wide ceiling on model-backed runs per UTC day, across all customers (spend control). */
  GLOBAL_RUNS_PER_DAY?: string;
  /** Set to "false" to stop all model-backed runs immediately (kill switch). */
  RUNS_ENABLED?: string;
  FREE_RUNS_PER_DAY?: string;
  PRO_RUNS_PER_DAY?: string;
  /** Polar billing: product for the Pro plan, API environment, and secrets set with `wrangler secret put`. */
  POLAR_PRODUCT_ID?: string;
  POLAR_SERVER?: "production" | "sandbox";
  POLAR_ACCESS_TOKEN?: string;
  POLAR_WEBHOOK_SECRET?: string;
  CANONICAL_REPO: string;
}

export type QueueMessage =
  | { type: "git.push"; projectId: string; taskId: string; commit: string; ready: boolean; eventId: string }
  | { type: "integration.requested"; projectId: string; taskIds: string[]; eventId: string }
  | { type: "webhook.deliver"; projectId: string; deliveryId: string }
  | { type: "probe"; sentAt: number };
