import type { ArtifactsBinding } from "../artifacts/cloudflare.js";
import type { AiBinding } from "../ai/workers-ai.js";

export interface Env {
  REPOSITORY_CONTROLLER: DurableObjectNamespace;
  INTEGRATOR: DurableObjectNamespace<import("./integrator.js").IntegratorSandbox>;
  AGENT: DurableObjectNamespace<import("./integrator.js").AgentSandbox>;
  SCENARIO_WORKFLOW: Workflow;
  INTEGRATION_WORKFLOW: Workflow;
  INTEGRATION_QUEUE: Queue<QueueMessage>;
  EVIDENCE_BUCKET: R2Bucket;
  ARTIFACTS: ArtifactsBinding;
  AI: AiBinding;
  ASSETS: Fetcher;
  /** Cloudflare Access team domain, e.g. myteam.cloudflareaccess.com (var). */
  ACCESS_TEAM_DOMAIN: string;
  /** Cloudflare Access application audience tag (var). */
  ACCESS_AUD: string;
  /** Dedicated origin serving previews (e.g. https://preview.flaregit.com), isolated from the app origin. */
  PREVIEW_ORIGIN: string;
  AI_GATEWAY_ID?: string;
  /** Daily model-backed run allowance per plan (spend control). */
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
  | { type: "integration.requested"; projectId: string; taskIds: [string, string]; eventId: string };
