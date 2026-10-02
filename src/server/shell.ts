export const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** Bearer credentials reach git only through the environment of that single exec (never argv/URL). */
export const gitAuthEnv = (token: string): Record<string, string> => ({
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "http.extraHeader",
  GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
});

export const PROTECTED_PATHS = [".flaregit/", ".github/", "tests/", "verifier/", "package.json", "tsconfig.json", "bun.lock"];

/** Stable, non-reversible project id for an authenticated identity (tenant isolation key). */
export async function projectIdFor(identity: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}
