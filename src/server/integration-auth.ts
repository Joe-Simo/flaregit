import { z } from "zod";
import { deploymentReportSchema } from "./deployments.js";
import { redactSecrets } from "../agents/prompt.js";

export const integrationCapabilities = ["read-candidate", "report-check", "comment", "report-deployment"] as const;
export type IntegrationCapability = typeof integrationCapabilities[number];
const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const sha = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
export const externalCheckSchema = z.object({
  type: z.literal("check"), candidateId: identifier, commit: sha, tree: sha, checkId: identifier, runId: identifier,
  policyVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["queued", "running", "passed", "failed", "cancelled"]), summary: z.string().max(4000),
  detailsUrl: z.string().url().max(2048).refine((value) => {
    try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || redactSecrets(decodeURIComponent(url.pathname)) !== decodeURIComponent(url.pathname)) return false;
    for (const [key, queryValue] of url.searchParams) {
      if (/(?:^|[_-])(?:token|signature|sig|secret|password|passwd|api[_-]?key|authorization|credential|jwt)(?:$|[_-])/i.test(key) || redactSecrets(queryValue) !== queryValue) return false;
    }
    return !url.hash || redactSecrets(decodeURIComponent(url.hash)) === decodeURIComponent(url.hash);
    } catch { return false; }
  }).optional(),
}).strict();
export const automatedReviewSchema = z.object({
  type: z.literal("comment"), candidateId: identifier, commit: sha, body: z.string().trim().min(1).max(8000),
  path: z.string().min(1).max(500).refine((value) => !value.startsWith("/") && !/[\x00-\x1f\\]/.test(value) && !value.split("/").some((part) => !part || part === "." || part === ".." || part === ".git")).optional(),
  line: z.number().int().positive().max(10_000_000).optional(),
}).strict().refine((value) => value.line === undefined || value.path !== undefined);
export const integrationCallbackSchema = z.object({
  serviceId: identifier, repositoryId: identifier, eventId: identifier, timestamp: z.number().int().nonnegative(),
  report: z.discriminatedUnion("type", [externalCheckSchema, automatedReviewSchema, deploymentReportSchema]),
}).strict();
export type IntegrationCallback = z.infer<typeof integrationCallbackSchema>;

async function digest(secret: string, raw: string): Promise<Uint8Array> {
  if (secret.length < 32) throw new Error("Integration signing secret is not configured securely");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`flaregit-integration-v1\n${raw}`)));
}
/** Sign the exact request bytes, including service/repository/event/timestamp and report. */
export async function signIntegrationCallback(secret: string, raw: string): Promise<string> {
  return [...await digest(secret, raw)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
/** Timestamp freshness bounds replay exposure; durable eventId deduplication is a
 * separate repository-scoped ledger responsibility. This grants no merge authority.
 */
export async function verifyIntegrationCallback(input: { secret: string; raw: string; signature: string; serviceId: string; repositoryId: string; capabilities: readonly IntegrationCapability[]; now?: number }): Promise<IntegrationCallback | null> {
  if (new TextEncoder().encode(input.raw).length > 65_536 || !/^[0-9a-f]{64}$/.test(input.signature)) return null;
  const expected = await digest(input.secret, input.raw);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i]! ^ Number.parseInt(input.signature.slice(i * 2, i * 2 + 2), 16);
  if (difference !== 0) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(input.raw); } catch { return null; }
  const result = integrationCallbackSchema.safeParse(parsed);
  if (!result.success) return null;
  const callback = result.data;
  if (callback.serviceId !== input.serviceId || callback.repositoryId !== input.repositoryId || Math.abs(Math.floor((input.now ?? Date.now()) / 1000) - callback.timestamp) > 300) return null;
  if (!input.capabilities.includes(callback.report.type === "check" ? "report-check" : callback.report.type === "deployment" ? "report-deployment" : "comment")) return null;
  return callback;
}
