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
  fixture: "ticket-booking" | "custom";
  protectedPaths: string[];
  allowedScope: string[];
  checkCommand?: string;
}

const DEMO_PROTECTED = [".flaregit/", ".github/", "tests/", "verifier/", "package.json", "tsconfig.json", "bun.lock"];

/** What contributors may touch and how a candidate is verified, derived only from platform-held policy. */
export function settingsFor(policy: Record<string, unknown> | undefined): ProjectSettings {
  if (isCommandPolicy(policy)) {
    return {
      fixture: "custom",
      protectedPaths: policy.protectedPaths ?? DEFAULT_PROTECTED_PATHS,
      allowedScope: policy.allowedScope && policy.allowedScope.length > 0 ? policy.allowedScope : ["*"],
      checkCommand: policy.test,
    };
  }
  return { fixture: "ticket-booking", protectedPaths: DEMO_PROTECTED, allowedScope: ["src/"] };
}
