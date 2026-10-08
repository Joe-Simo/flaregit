/** F17 slice: one permission truth for the web, CLI and API clients. Pure: no I/O, and the clock is injected. */

import {can, type Role} from "./org-access";
import {allows, type Scope} from "./token-scopes";

export const CLIENT_SURFACES = ["web", "cli", "api"] as const;
export type ClientSurface = (typeof CLIENT_SURFACES)[number];

export const CLIENT_CAPABILITIES = ["read_repository", "comment", "review", "merge", "manage_members", "delete_repository"] as const;
export type ClientCapability = (typeof CLIENT_CAPABILITIES)[number];

export interface CapabilityRule {
  /** The lowest organization role that may perform the capability. */
  readonly minimumRole: Role;
  /** The token scope an API token must hold. Null means no token scope grants the capability, so API tokens never can. */
  readonly tokenScope: Scope | null;
  /** Destructive capabilities need an explicit confirmation token from every surface. */
  readonly destructive: boolean;
}

export const CLIENT_CAPABILITY_RULES: Readonly<Record<ClientCapability, CapabilityRule>> = {
  read_repository: {minimumRole: "read", tokenScope: "code:read", destructive: false},
  comment: {minimumRole: "read", tokenScope: "issues:write", destructive: false},
  review: {minimumRole: "triage", tokenScope: "reviews:write", destructive: false},
  merge: {minimumRole: "write", tokenScope: "code:write", destructive: false},
  manage_members: {minimumRole: "admin", tokenScope: null, destructive: false},
  delete_repository: {minimumRole: "admin", tokenScope: null, destructive: true},
};

export interface ClientGrant {
  readonly role: Role;
  /** Scopes held by an API token. Web and CLI ignore them and act with the user's role alone. */
  readonly tokenScopes?: readonly Scope[];
  /** The user's explicit confirmation for a destructive capability. Any non-blank value passes here; the surface must obtain it from the user. */
  readonly confirmationToken?: string;
}

export function isClientSurface(value: unknown): value is ClientSurface {
  return typeof value === "string" && (CLIENT_SURFACES as readonly string[]).includes(value);
}

export function isClientCapability(value: unknown): value is ClientCapability {
  return typeof value === "string" && (CLIENT_CAPABILITIES as readonly string[]).includes(value);
}

/** Whether a surface must collect an explicit confirmation from the user before performing the capability. */
export function requiresConfirmation(capability: ClientCapability): boolean {
  return CLIENT_CAPABILITY_RULES[capability].destructive;
}

/**
 * Web and CLI act with the user's role. An API token must also hold the scope the capability maps to, and a token scope never raises the role.
 * Destructive capabilities need a confirmation token on every surface. Unknown surfaces, capabilities and roles are refused.
 */
export function canPerform(surface: ClientSurface, capability: ClientCapability, grant: ClientGrant): boolean {
  if (!isClientSurface(surface) || !isClientCapability(capability)) return false;
  const rule = CLIENT_CAPABILITY_RULES[capability];
  if (!can(grant.role, rule.minimumRole)) return false;
  if (rule.destructive && !(typeof grant.confirmationToken === "string" && grant.confirmationToken.trim().length > 0)) return false;
  if (surface !== "api") return true;
  if (rule.tokenScope === null) return false;
  return allows(grant.tokenScopes ?? [], rule.tokenScope);
}

/** Requests each surface may make per minute. */
export const CLIENT_REQUESTS_PER_MINUTE: Readonly<Record<ClientSurface, number>> = {api: 600, cli: 300, web: 1200};

const WINDOW_MS = 60_000;

export interface BudgetDecision {
  readonly allowed: boolean;
  /** Seconds until the surface's window resets. Zero when the request is allowed. */
  readonly retryAfterSeconds: number;
}

export interface ClientRequestBudget {
  consume(surface: ClientSurface): BudgetDecision;
}

/**
 * Counts requests per surface in fixed one-minute windows, with time read from the injected clock in milliseconds.
 * Refused requests are not counted. Fixed windows allow up to twice the limit across a window boundary.
 */
export function createClientRequestBudget(options: {readonly now: () => number}): ClientRequestBudget {
  const buckets = new Map<ClientSurface, {index: number; count: number}>();
  return {
    consume(surface) {
      if (!isClientSurface(surface)) throw new RangeError("Unknown client surface");
      const now = options.now();
      if (!Number.isFinite(now)) throw new RangeError("The clock must return a finite time in milliseconds");
      const index = Math.floor(now / WINDOW_MS);
      const current = buckets.get(surface);
      const bucket = current?.index === index ? current : {index, count: 0};
      if (bucket.count >= CLIENT_REQUESTS_PER_MINUTE[surface]) {
        return {allowed: false, retryAfterSeconds: Math.ceil(((index + 1) * WINDOW_MS - now) / 1000)};
      }
      bucket.count += 1;
      buckets.set(surface, bucket);
      return {allowed: true, retryAfterSeconds: 0};
    },
  };
}

/** Roles a web control may expose as interactive. Anything else is refused, so a clickable div cannot pass as a control. */
export const WEB_INTERACTIVE_ROLES = ["button", "link", "checkbox", "radio", "switch", "textbox", "searchbox", "combobox", "menuitem", "tab", "option", "slider"] as const;

const interactiveRoles: ReadonlySet<string> = new Set<string>(WEB_INTERACTIVE_ROLES);

export interface WebInteractiveElement {
  readonly role: string;
  readonly label?: string | null;
}

export type WebAccessibilityCheck = {readonly ok: true} | {readonly ok: false; readonly reason: "role_not_allowed" | "missing_label"};

/** Minimal web accessibility guard: the role must be an interactive role, and the element must have a non-blank label. */
export function checkWebInteractiveElement(element: WebInteractiveElement): WebAccessibilityCheck {
  if (!interactiveRoles.has(element.role)) return {ok: false, reason: "role_not_allowed"};
  if (typeof element.label !== "string" || element.label.trim().length === 0) return {ok: false, reason: "missing_label"};
  return {ok: true};
}
