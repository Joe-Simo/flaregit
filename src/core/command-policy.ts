/** Ordinary repositories can verify Git integrity without claiming application tests. */
export interface GitIntegrityPolicy {
  kind: "git-integrity";
  allowedScope?: string[];
  protectedPaths?: string[];
  landing?: "merge" | "squash";
}
export const GIT_INTEGRITY_POLICY: GitIntegrityPolicy = {
  kind: "git-integrity", allowedScope: ["*"], protectedPaths: [".flaregit/"], landing: "merge",
};
function validPaths(value:unknown):value is string[]{return Array.isArray(value)&&value.length>0&&value.every(path=>typeof path==="string"&&path.length>0&&!path.startsWith("/")&&!path.includes("\\")&&!path.split("/").some(part=>part==="."||part==="..")&&!/[\u0000-\u001f\u007f]/.test(path));}
export function isGitIntegrityPolicy(policy:unknown):policy is GitIntegrityPolicy {
  if(!policy||typeof policy!=="object"||!("kind" in policy)||policy.kind!=="git-integrity")return false;
  return (!("allowedScope" in policy)||validPaths(policy.allowedScope))&&(!("protectedPaths" in policy)||validPaths(policy.protectedPaths))&&(!("landing" in policy)||policy.landing==="merge"||policy.landing==="squash");
}

/** Light-weight (Worker-safe) definition of a customer repository's protected verification settings. */
export interface CommandPolicy {
  kind: "command";
  install?: string;
  build?: string;
  test: string;
  timeoutSec?: number;
  /** Paths contributors may change (prefix match; "*" = anywhere not protected). */
  allowedScope?: string[];
  /** Paths contributors may not change: tests, build config, dependency manifests. */
  protectedPaths?: string[];
  /** How a verified candidate lands: a merge commit per change (default) or one squashed commit with co-author trailers. */
  landing?: "merge" | "squash";
}

export const DEFAULT_PROTECTED_PATHS = [
  ".flaregit/", ".github/", "tests/", "test/", "__tests__/", "spec/",
  "package.json", "bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
  "tsconfig.json", "vitest.config.ts", "jest.config.js", "jest.config.ts", "Makefile", "Dockerfile",
];

export function isCommandPolicy(p: unknown): p is CommandPolicy {
  return typeof p === "object" && p !== null && (p as { kind?: string }).kind === "command" && typeof (p as { test?: unknown }).test === "string";
}

export interface ProjectSettings {
  fixture: "ticket-booking" | "custom" | "git-integrity";
  protectedPaths: string[];
  allowedScope: string[];
  checkCommand?: string;
  landing: "merge" | "squash";
}

const DEMO_PROTECTED = [".flaregit/", ".github/", "tests/", "verifier/", "package.json", "tsconfig.json", "bun.lock"];

/** What contributors may touch and how a candidate is verified, derived only from platform-held policy. */
export function settingsFor(policy: Record<string, unknown> | undefined): ProjectSettings {
  if(policy?.kind==="git-integrity"){
    if(!isGitIntegrityPolicy(policy))throw new Error("Git integrity policy is invalid");
    return {fixture:"git-integrity",protectedPaths:[...new Set([".flaregit/", ...(policy.protectedPaths??[])])],allowedScope:[...(policy.allowedScope??["*"])],landing:policy.landing==="squash"?"squash":"merge"};
  }
  if (isCommandPolicy(policy)) {
    return {
      fixture: "custom",
      protectedPaths: policy.protectedPaths ?? DEFAULT_PROTECTED_PATHS,
      allowedScope: policy.allowedScope && policy.allowedScope.length > 0 ? policy.allowedScope : ["*"],
      checkCommand: policy.test,
      landing: policy.landing === "squash" ? "squash" : "merge",
    };
  }
  return { fixture: "ticket-booking", protectedPaths: DEMO_PROTECTED, allowedScope: ["src/"], landing: "merge" };
}
