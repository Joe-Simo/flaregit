/**
 * F16 slice: agent execution environments. An environment is a validated, immutable grant: one repository at one commit,
 * a closed tool list, no secrets, exact-hostname egress, and bounded runtime and memory. Pure functions decide actions;
 * AgentRunLedger records each run and applies the runtime limit.
 */

export const AGENT_TOOLS = [
  "read_file",
  "write_file",
  "list_files",
  "search_code",
  "run_tests",
  "run_command",
  "git_commit",
  "fetch_url",
  "install_dependencies",
] as const;

export type AgentTool = (typeof AGENT_TOOLS)[number];
export type AgentNetworkMode = "none" | "allowlist";
export type AgentRunStatus = "running" | "succeeded" | "failed" | "timed_out" | "cancelled";
export type AgentRunOutcome = Exclude<AgentRunStatus, "running">;

/** Milliseconds since the epoch, like Date.now. */
export type AgentClock = () => number;

export interface AgentEnvironment {
  readonly id: string;
  readonly repository: string;
  readonly commit: string;
  readonly allowedTools: readonly AgentTool[];
  readonly network: AgentNetworkMode;
  readonly allowedHosts: readonly string[];
  readonly secretsGranted: false;
  readonly maxRuntimeSeconds: number;
  readonly maxMemoryMb: number;
}

/** Caller-supplied request. Every field is validated, including those the type system already constrains. */
export interface AgentEnvironmentRequest {
  readonly id: string;
  readonly repository: string;
  readonly commit: string;
  readonly allowedTools: readonly string[];
  readonly network: AgentNetworkMode;
  readonly allowedHosts: readonly string[];
  readonly secretsGranted: boolean;
  readonly maxRuntimeSeconds: number;
  readonly maxMemoryMb: number;
}

export interface AgentAction {
  readonly tool: string;
  readonly repository: string;
  /** Present for network actions. */
  readonly host?: string;
}

export interface AgentRunRecord {
  readonly runId: string;
  readonly environmentId: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly status: AgentRunStatus;
}

export class AgentRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRefusedError";
  }
}

const AGENT_TOOL_SET: ReadonlySet<string> = new Set<string>(AGENT_TOOLS);
/** Tools whose actions reach the network, so they need an allowlisted host even when the caller omits one. */
const NETWORK_TOOLS: ReadonlySet<string> = new Set<string>(["fetch_url", "install_dependencies"]);
const OUTCOMES: ReadonlySet<string> = new Set<string>(["succeeded", "failed", "timed_out", "cancelled"]);
const COMMIT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const IDENTIFIER = /^\S+$/;
/** Characters that cannot appear in a bare hostname: whitespace, wildcards, paths, userinfo, query, fragment, zone ids, brackets. */
const HOST_FORBIDDEN = /[\s*\/\\@?#%[\]]/;
const MAX_HOST_LENGTH = 253;
const MIN_RUNTIME_SECONDS = 1;
const MAX_RUNTIME_SECONDS = 3600;
const MIN_MEMORY_MB = 64;
const MAX_MEMORY_MB = 8192;

interface RunEntry {
  readonly environmentId: string;
  readonly startedAt: number;
  readonly limitMs: number;
  readonly clock: AgentClock;
  status: AgentRunStatus;
  endedAt: number | null;
}

function refuse(message: string): never {
  throw new AgentRefusedError(message);
}

function isAgentTool(value: string): value is AgentTool {
  return AGENT_TOOL_SET.has(value);
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Returns the lowercase hostname or IP literal when the input is exactly that and nothing else, otherwise null.
 * The URL parser must return the same string, which rejects ports, userinfo, paths, non-canonical IP forms and
 * brackets. IPv6 literals are written bare (for example 2001:db8::1).
 */
function canonicalHost(value: string): string | null {
  const host = value.toLowerCase();
  if (host.length === 0 || host.length > MAX_HOST_LENGTH || HOST_FORBIDDEN.test(host)) return null;
  const bare = host.includes(":") ? `[${host}]` : host;
  try {
    return new URL(`https://${bare}/`).hostname === bare ? host : null;
  } catch {
    return null;
  }
}

function exactHosts(entries: readonly string[]): string[] {
  if (entries.length === 0) refuse("a network allowlist needs at least one exact host");
  const hosts = new Set<string>();
  for (const entry of entries) {
    if (typeof entry === "string" && entry.includes("*")) refuse("wildcard hosts are refused; list each host exactly");
    const host = canonicalHost(entry);
    if (host === null) refuse(`not an exact hostname, IP literal or allowed form: ${String(entry)}`);
    hosts.add(host);
  }
  return [...hosts];
}

export function createAgentEnvironment(request: AgentEnvironmentRequest): AgentEnvironment {
  if (typeof request.id !== "string" || !IDENTIFIER.test(request.id)) {
    refuse("environment id must be a non-empty identifier without whitespace");
  }
  if (typeof request.repository !== "string" || !IDENTIFIER.test(request.repository)) {
    refuse("repository must be a non-empty identifier without whitespace");
  }
  if (typeof request.commit !== "string" || !COMMIT_ID.test(request.commit)) {
    refuse("commit must be a full lowercase object id");
  }
  if (!Array.isArray(request.allowedTools)) refuse("allowedTools must be a list");
  const allowedTools: AgentTool[] = [];
  for (const tool of request.allowedTools) {
    if (!isAgentTool(tool)) refuse(`tool is not in the known agent tool list: ${String(tool)}`);
    allowedTools.push(tool);
  }
  if (request.network !== "none" && request.network !== "allowlist") {
    refuse("network must be none or allowlist");
  }
  if (!Array.isArray(request.allowedHosts)) refuse("allowedHosts must be a list");
  if (request.network === "none" && request.allowedHosts.length > 0) {
    refuse("network none cannot list allowed hosts");
  }
  const allowedHosts = request.network === "allowlist" ? exactHosts(request.allowedHosts) : [];
  if (request.secretsGranted !== false) refuse("agent environments cannot be granted secrets");
  if (!inRange(request.maxRuntimeSeconds, MIN_RUNTIME_SECONDS, MAX_RUNTIME_SECONDS)) {
    refuse(`maxRuntimeSeconds must be an integer from ${MIN_RUNTIME_SECONDS} to ${MAX_RUNTIME_SECONDS}`);
  }
  if (!inRange(request.maxMemoryMb, MIN_MEMORY_MB, MAX_MEMORY_MB)) {
    refuse(`maxMemoryMb must be an integer from ${MIN_MEMORY_MB} to ${MAX_MEMORY_MB}`);
  }
  const environment: AgentEnvironment = {
    id: request.id,
    repository: request.repository,
    commit: request.commit,
    allowedTools: Object.freeze(allowedTools),
    network: request.network,
    allowedHosts: Object.freeze(allowedHosts),
    secretsGranted: false,
    maxRuntimeSeconds: request.maxRuntimeSeconds,
    maxMemoryMb: request.maxMemoryMb,
  };
  return Object.freeze(environment);
}

/** True only when the environment allows network access and the host is listed exactly (case-insensitive). */
export function hostAllowed(environment: AgentEnvironment, host: string): boolean {
  if (environment.network !== "allowlist" || typeof host !== "string") return false;
  const canonical = canonicalHost(host);
  return canonical !== null && environment.allowedHosts.includes(canonical);
}

/**
 * Allowed only when the tool is granted and the repository matches. An action that names a host, or uses a network
 * tool, must also pass hostAllowed. A network tool without a host is refused.
 */
export function agentActionAllowed(environment: AgentEnvironment, action: AgentAction): boolean {
  const granted: readonly string[] = environment.allowedTools;
  if (!granted.includes(action.tool) || action.repository !== environment.repository) return false;
  const networked = action.host !== undefined || NETWORK_TOOLS.has(action.tool);
  if (!networked) return true;
  return action.host !== undefined && hostAllowed(environment, action.host);
}

function readClock(clock: AgentClock): number {
  const now = clock();
  if (!Number.isFinite(now)) refuse("clock must return a finite time in milliseconds");
  return now;
}

function expired(entry: RunEntry, now: number): boolean {
  return now - entry.startedAt > entry.limitMs;
}

function snapshot(runId: string, entry: RunEntry): AgentRunRecord {
  return Object.freeze({
    runId,
    environmentId: entry.environmentId,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    status: entry.status,
  });
}

/**
 * In-memory run ledger. A run starts once and finishes once. If its clock passes maxRuntimeSeconds, the run is
 * recorded as timed_out whatever outcome is reported, and reading an overdue run records the timeout too.
 */
export class AgentRunLedger {
  private readonly runs = new Map<string, RunEntry>();

  startRun(environment: AgentEnvironment, runId: string, clock: AgentClock): AgentRunRecord {
    const checked = createAgentEnvironment(environment);
    if (typeof runId !== "string" || !IDENTIFIER.test(runId)) {
      refuse("run id must be a non-empty identifier without whitespace");
    }
    if (this.runs.has(runId)) refuse(`run ${runId} already exists`);
    const entry: RunEntry = {
      environmentId: checked.id,
      startedAt: readClock(clock),
      limitMs: checked.maxRuntimeSeconds * 1000,
      clock,
      status: "running",
      endedAt: null,
    };
    this.runs.set(runId, entry);
    return snapshot(runId, entry);
  }

  finishRun(runId: string, outcome: AgentRunOutcome): AgentRunRecord {
    if (!OUTCOMES.has(outcome)) refuse(`unknown run outcome: ${String(outcome)}`);
    const entry = this.entryFor(runId);
    if (entry.status !== "running") refuse(`run ${runId} already finished as ${entry.status}`);
    const now = readClock(entry.clock);
    entry.status = expired(entry, now) ? "timed_out" : outcome;
    entry.endedAt = now;
    return snapshot(runId, entry);
  }

  getRun(runId: string): AgentRunRecord | undefined {
    const entry = this.runs.get(runId);
    if (entry === undefined) return undefined;
    if (entry.status === "running") {
      const now = readClock(entry.clock);
      if (expired(entry, now)) {
        entry.status = "timed_out";
        entry.endedAt = now;
      }
    }
    return snapshot(runId, entry);
  }

  private entryFor(runId: string): RunEntry {
    const entry = this.runs.get(runId);
    if (entry === undefined) refuse(`unknown run ${runId}`);
    return entry;
  }
}
