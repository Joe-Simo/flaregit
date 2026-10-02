import { redactSecrets } from "../agents/prompt.js";

/** Commands are shared verification policy, so credential literals cannot be stored here. */
export function validateRepositoryCommand(input: unknown): string {
  if (input === undefined) return "";
  if (typeof input !== "string" || input.length > 300) throw new Error("Repository commands must be strings of at most 300 characters");
  if (redactSecrets(input) !== input) throw new Error("Do not embed credentials in repository commands; verification commands must not contain secret values");
  for (const match of input.matchAll(/(?:^|[\s;])(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|[a-z0-9_]+_token)=([^\s;]+)/gi)) {
    const value = match[1]!;
    if (value.length >= 8 && !/^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})$/.test(value)) throw new Error("Do not embed credentials in repository commands; use environment references instead of literal assignments");
  }
  return input.trim();
}

/** Validate an unauthenticated HTTPS Git source without limiting it to a vendor.
 * This rejects private-looking names and credential-bearing URL fields. It does
 * not prove the resolved IP is public: the Artifacts fetch service must also
 * enforce egress policy on DNS resolution and every redirect.
 */
export function validateImportSource(input: unknown): URL {
  if (typeof input !== "string" || !input.trim() || input.length > 2048 || /[\x00-\x20\\]/.test(input)) throw new Error("Enter a valid HTTPS Git repository URL without whitespace");
  let source: URL;
  try { source = new URL(input); }
  catch { throw new Error("Enter a valid HTTPS Git repository URL"); }
  if (source.protocol !== "https:" || source.username || source.password) throw new Error("Imports require public HTTPS URLs without embedded credentials");
  // Query credentials must never reach saved source metadata, provider errors,
  // contributor context or public descriptions. Git sources do not need queries.
  if (source.search || source.hash) throw new Error("Repository URLs cannot contain query parameters or fragments; remove any access credentials");
  const host = source.hostname.toLowerCase().replace(/\.$/, "");
  const labels = host.split(".");
  if (host.includes(":") || host.startsWith("[") || /^\d+(?:\.\d+)*$/.test(host) || labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error("Repository URLs must use a public DNS hostname, not an IP or local name");
  if (["localhost", "local", "internal", "lan", "home", "test", "invalid"].some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) throw new Error("Local and internal repository hosts are unsupported");
  let path: string;
  try { path = decodeURIComponent(source.pathname); }
  catch { throw new Error("Repository URL contains invalid encoding"); }
  if (/[\x00-\x1f\x7f\\]/.test(path)) throw new Error("Repository URL contains invalid path characters");
  if (!path || path === "/") throw new Error("Enter the repository path on the Git host");
  if (redactSecrets(path) !== path) throw new Error("Repository URL path contains a credential; use a public repository URL");
  source.hostname = host;
  return source;
}
