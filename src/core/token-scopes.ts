/** F14 slice: API token scope checks. Tokens are least-privilege; a write scope implies read of the same resource only. */

export type Scope = `${"issues" | "code" | "reviews"}:${"read" | "write"}`;

export function allows(granted: readonly Scope[], needed: Scope): boolean {
  if (granted.includes(needed)) return true;
  const [resource, action] = needed.split(":");
  return action === "read" && granted.includes(`${resource}:write` as Scope);
}

/** Parses a scope list from input; unknown scopes are refused rather than dropped. */
export function parseScopes(input: unknown): {readonly ok: true; readonly scopes: Scope[]} | {readonly ok: false; readonly error: string} {
  if (!Array.isArray(input) || input.length === 0) return {ok: false, error: "A token needs at least one scope"};
  const pattern = /^(issues|code|reviews):(read|write)$/;
  for (const item of input) if (typeof item !== "string" || !pattern.test(item)) return {ok: false, error: `Unknown scope ${String(item)}`};
  return {ok: true, scopes: [...new Set(input as Scope[])]};
}
