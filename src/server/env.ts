import type { ArtifactsBinding } from "../artifacts/cloudflare.js";
import type { AiBinding } from "../ai/workers-ai.js";

export interface Env {
  /** Private exact publisher checkpoint binding. Unset in ordinary/public deployments. */
  C03_PRIVATE_MATRIX_ENABLED?:string;
  C03_PUBLICATION_CHECKPOINT_GRANT_JSON?:string;
  C03_PUBLICATION_CHECKPOINT?:Fetcher;
  /** Resource creation is disabled unless explicitly approved; token stays server-side. */
  PREVIEW_PROVISIONING_ENABLED?:string;
  PREVIEW_PROVISIONING_GLOBAL_LIMIT?:string;
  PREVIEW_PROVISIONING_ACCOUNT_ID?:string;
  PREVIEW_PROVISIONING_API_TOKEN?:string;
  PREVIEW_PROVISIONING_SUBDOMAIN?:string;
  PREVIEW_PROVISIONING_APP_ORIGIN?:string;
  PREVIEW_PROVISIONING_BROKER_SERVICE?:string;
  PREVIEW_PROVISIONING_MODULE?:string;
  PREVIEW_PROVISIONING_MODULE_SHA256?:string;
  PREVIEW_PROVISIONING_COMPATIBILITY_DATE?:string;
  /** Server release identity for exact-version acceptance receipts. */
  CF_VERSION_METADATA?:WorkerVersionMetadata;
  FLAREGIT_SOURCE_VERSION?:string;
  /** Optional server-only immutable native integration phase. */
  INTEGRATION_NATIVE_PHASE_JSON?:string;
  PUBLICATION_NATIVE_PHASE_JSON?:string;
  PUBLICATION_NATIVE_PHASES_JSON?:string;
  C03_PUBLICATION_CHECKPOINT_GRANTS_JSON?:string;
  /** C02 stays unavailable until an operator approves the pinned image/policy. */
  ISOLATED_EXECUTION_IMAGE?: string;
  ISOLATED_BROWSER_POLICY_DIGEST?: string;
  /** Separate C02 resources; absence refuses execution, never falls back to INTEGRATOR. */
  UNTRUSTED_EXECUTION?: DurableObjectNamespace<import('./untrusted-execution-sandbox').UntrustedExecutionSandbox>;
  UNTRUSTED_EGRESS?: Fetcher;
  EXECUTION_AUTHORITY?: Fetcher;
  VERIFICATION_BROWSER?: import('./cloudflare-browser-transport').VerificationBrowserBinding & Partial<import('./cloudflare-browser-transport').BrowserSessionControl>;
  /** Explicit canary browser admission envelope; unset disables allocation. */
  BROWSER_SESSION_RESERVATION_USD_MICROS?: string;
  /** Restricted agent rollout requires installed relay and public CA trust. */
  AGENT_RESTRICTED_EGRESS_ENABLED?: string;
  ISOLATED_AGENT_IMAGE?: string;
  /** Retained optional preview assets only; unset disables new storage reservations. */
  EVIDENCE_STORAGE_GLOBAL_BYTES?: string;
  EVIDENCE_STORAGE_ACCOUNT_BYTES?: string;
  /** Operator-funded optional preview read attempts, independent of managed compute. */
  PREVIEW_READ_GLOBAL_MONTHLY_ATTEMPTS?: string;
  PREVIEW_READ_OWNER_MONTHLY_ATTEMPTS?: string;
  PREVIEW_STORAGE_GLOBAL_BYTES?: string;
  PREVIEW_STORAGE_ACCOUNT_BYTES?: string;
  CORE_GIT_GLOBAL_MONTHLY_USD_MICROS?: string;
  CORE_GIT_ACCOUNT_MONTHLY_USD_MICROS?: string;
  /** Browsing reservations inside the shared Git-operation allowance. */
  REPOSITORY_READ_GLOBAL_MONTHLY_USD_MICROS?: string;
  REPOSITORY_READ_ACCOUNT_MONTHLY_USD_MICROS?: string;
  REPOSITORY_CONTROLLER: DurableObjectNamespace;
  INTEGRATOR: DurableObjectNamespace<import("./integrator.js").IntegratorSandbox>;
  AGENT: DurableObjectNamespace<import("./integrator.js").AgentSandbox>;
  SCENARIO_WORKFLOW: Workflow;
  AGENT_WORKFLOW: Workflow;
  INTEGRATION_WORKFLOW: Workflow;
  IMPORT_HISTORY_WORKFLOW: Workflow;
  REBASE_RESUME_WORKFLOW?: Workflow;
  PRIVATE_RECOVERY_WORKFLOW?: Workflow;
  INTEGRATION_QUEUE: Queue<QueueMessage>;
  EVIDENCE_BUCKET: R2Bucket;
  ARTIFACTS: ArtifactsBinding;
  AI: AiBinding;
  ASSETS: Fetcher;
  /** HMAC key for preview capability links (secret). */
  PREVIEW_SIGNING_KEY?: string;
  /** Comma-separated account keys of the people who handle abuse and impersonation reports (var). */
  OPERATOR_ACCOUNTS?: string;
  /** Per-user API rate limit (Workers Rate Limiting binding). */
  /** Fixed per-IP credential/repository lookup admission, before any DO lookup. */
  LOOKUP_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  PREVIEW_ASSET_LIMITER: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  API_LIMITER: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  /** Clerk frontend API URL (the JWT issuer), e.g. https://example.clerk.accounts.dev (var). */
  CLERK_ISSUER?: string;
  /** Comma-separated origins allowed to mint session tokens (`azp`), e.g. https://flaregit.com (var). */
  CLERK_AUTHORIZED_PARTIES?: string;
  /** Clerk publishable key; public by design, served to the SPA via /api/config-free endpoint (var). */
  CLERK_PUBLISHABLE_KEY?: string;
  /** Deprecated shared preview origin; retained only for older configuration fixtures. */
  PREVIEW_ORIGIN?: string;
  /** Trusted JSON object mapping repository IDs to distinct HTTPS worker.workers.dev origins. */
  REPOSITORY_PREVIEW_ORIGINS?: string;
  AI_GATEWAY_ID?: string;
  /** Daily model-backed run allowance per plan (spend control). */
  /** Platform-wide ceiling on model-backed runs per UTC day, across all customers (spend control). */
  GLOBAL_RUNS_PER_DAY?: string;
  /** Set to "false" to stop all model-backed runs immediately (kill switch). */
  RUNS_ENABLED?: string;
  /** Explicit USD micros caps; unset disables managed execution. No customer billing effect. */
  MANAGED_ACCOUNT_MONTHLY_USD_MICROS?: string;
  MANAGED_ESSENTIAL_ACCOUNT_MONTHLY_USD_MICROS?: string;
  MANAGED_ESSENTIAL_GLOBAL_MONTHLY_USD_MICROS?: string;
  MANAGED_GLOBAL_MONTHLY_USD_MICROS?: string;
  FREE_RUNS_PER_DAY?: string;
  PRO_RUNS_PER_DAY?: string;
  /** Polar billing: product for the Pro plan, API environment, and secrets set with `wrangler secret put`. */
  POLAR_PRODUCT_ID?: string;
  POLAR_SERVER?: "production" | "sandbox";
  POLAR_ACCESS_TOKEN?: string;
  /** New paid checkout requires a verified offering; existing billing remains manageable. */
  PAID_CHECKOUT_ENABLED?: string;
  POLAR_WEBHOOK_SECRET?: string;
  /** Conservative retained-repository envelope, not customer storage entitlement. */
  ARTIFACT_STORAGE_NAMESPACE?: string;
  ARTIFACT_STORAGE_GLOBAL_SLOTS?: string;
  ARTIFACT_STORAGE_ACCOUNT_SLOTS?: string;
  CANONICAL_REPO: string;
}

export type QueueMessage =
  | { type: "git.push"; projectId: string; taskId: string; commit: string; ready: boolean; eventId: string }
  | { type: "integration.requested"; projectId: string; taskIds: string[]; eventId: string }
  | { type: "webhook.deliver"; projectId: string; deliveryId: string; generation?: number; blockedSequence?: number }
  | { type: "probe"; sentAt: number };
