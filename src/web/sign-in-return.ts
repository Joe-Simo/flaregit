const projectId = /^p?[0-9a-f]{12}$/;
const topicId = /^forum_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const repositoryTabs = new Set(["code", "commits", "issues", "changes", "integration", "people", "activity", "settings", "review", "commit"]);
/** Canonical app hashes only. Never use a supplied full URL as a Clerk destination. */
export function safeSignInReturn(value: string): string | null {
  const input = value.startsWith("#") ? value.slice(1) : value;
  if (!input.startsWith("/") || input.startsWith("//") || /[\\\x00-\x20#]/.test(input)) return null;
  const question = input.indexOf("?");
  const path = question < 0 ? input : input.slice(0, question);
  const query = new URLSearchParams(question < 0 ? "" : input.slice(question + 1));
  const destination = new URLSearchParams();
  const segments = path.split("/").slice(1);
  if (new Set([...query.keys()]).size !== [...query.keys()].length) return null;
  const allowed = new Set(["signin"]);
  if (["/", "/new", "/account", "/inbox", "/report", "/operator"].includes(path)) { /* Exact local routes need no parameters. */ }
  else if (path === "/community-post") {
    allowed.add("topic"); const topic = query.get("topic");
    if (topic !== null) { if (!topicId.test(topic)) return null; destination.set("topic", topic); }
  } else if (segments[0] === "participate" && segments.length === 2 && projectId.test(segments[1] ?? "")) { /* Repository IDs carry no credentials. */ }
  else if (segments[0] === "p" && (segments.length === 2 || (segments.length === 3 && repositoryTabs.has(segments[2] ?? ""))) && projectId.test(segments[1] ?? "")) {
    const rules: Record<string, RegExp> = { task: /^[a-z0-9-]{1,200}$/, candidate: /^[A-Za-z0-9_-]{1,200}$/, hash: /^[0-9a-f]{7,40}$/, n: /^[1-9][0-9]{0,9}$/ };
    for (const [name, rule] of Object.entries(rules)) { allowed.add(name); const parameter = query.get(name); if (parameter !== null) { if (!rule.test(parameter)) return null; destination.set(name, parameter); } }
  } else return null;
  if ([...query.keys()].some((name) => !allowed.has(name))) return null;
  if (query.has("signin") && query.get("signin") !== "1") return null;
  return `${path}${destination.size ? `?${destination}` : ""}`;
}
