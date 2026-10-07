import { safeReportTarget } from "./report-target";
const projectId = /^p?[0-9a-f]{12}$/;
const topicId = /^forum_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const repositoryTabs = new Set(["code", "commits", "discussions", "issues", "changes", "integration", "people", "activity", "settings", "review", "commit", "releases", "tags"]);
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
  if (path === "/join-resume") { allowed.add("context"); const context = query.get("context"); if (!context || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(context)) return null; destination.set("context", context); }
  else if (["/", "/new", "/account", "/inbox", "/operator"].includes(path)) { /* Exact local routes need no parameters. */ }
  else if (path === "/report") {
    allowed.add("target"); allowed.add("kind");
    const target = query.get("target"), kind = query.get("kind");
    if (target !== null) { const safe = safeReportTarget(target); if (!safe) return null; destination.set("target", safe); }
    if (kind !== null) { if (!["impersonation","namespace_squatting","malware","harassment","security","other"].includes(kind)) return null; destination.set("kind", kind); }
  } else if (path === "/community") {
    allowed.add("repo"); allowed.add("topic"); allowed.add("view");
    const repo = query.get("repo"), topic = query.get("topic"), view = query.get("view");
    if (view !== null) { if (!["activity", "following", "repositories", "people", "help"].includes(view) || repo !== null) return null; destination.set("view", view); }
    if (repo !== null) { if (!projectId.test(repo)) return null; destination.set("repo", repo); }
    if (topic !== null) {
      const valid = repo ? /^discussion_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(topic) : view === "help" && topicId.test(topic);
      if (!valid) return null; destination.set("topic", topic);
    }
  } else if (path === "/community-post") {
    allowed.add("topic"); allowed.add("repo"); const topic = query.get("topic"), repo = query.get("repo");
    if (repo !== null) { if (!projectId.test(repo)) return null; destination.set("repo", repo); }
    if (topic !== null) { const valid = repo ? /^discussion_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(topic) : topicId.test(topic); if (!valid) return null; destination.set("topic", topic); }
  } else if (segments[0] === "participate" && segments.length === 2 && projectId.test(segments[1] ?? "")) { /* Repository IDs carry no credentials. */ }
  else if (segments[0] === "p" && (segments.length === 2 || (segments.length === 3 && repositoryTabs.has(segments[2] ?? ""))) && projectId.test(segments[1] ?? "")) {
    const rules: Record<string, RegExp> = { topic: /^discussion_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, task: /^[a-z0-9-]{1,200}$/, candidate: /^[A-Za-z0-9_-]{1,200}$/, hash: /^[0-9a-f]{7,40}$/, n: /^[1-9][0-9]{0,9}$/ };
    for (const [name, rule] of Object.entries(rules)) { allowed.add(name); const parameter = query.get(name); if (parameter !== null) { if (!rule.test(parameter)) return null; destination.set(name, parameter); } }
    if (segments[2] === "review") {
      const reviewRules = { commit: /^[a-f0-9]{7,40}$/, base: /^[a-f0-9]{40}$/, input: /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/ };
      for (const [name, rule] of Object.entries(reviewRules)) { allowed.add(name); const parameter = query.get(name); if (parameter !== null) { if (!rule.test(parameter)) return null; destination.set(name, parameter); } }
      const commit = query.get("commit"), base = query.get("base"), frozen = query.get("input");
      if (base !== null && (!/^[a-f0-9]{40}$/.test(commit ?? "") || query.has("task") || query.has("candidate") || frozen !== null)) return null;
      if (frozen !== null && (!query.has("candidate") || query.has("task") || commit !== null)) return null;
      allowed.add("from");
      if (query.has("from")) { if (query.get("from") !== "recovery" || base === null || commit === null) return null; destination.set("from", "recovery"); }
    }
  } else return null;
  if ([...query.keys()].some((name) => !allowed.has(name))) return null;
  if (query.has("signin") && query.get("signin") !== "1") return null;
  return `${path}${destination.size ? `?${destination}` : ""}`;
}


/** A product intent must validate completely before it can override an OAuth return. */
export function explicitSignInReturn(value: string): string | null {
  const destination = safeSignInReturn(value);
  if (!destination) return null;
  const query = new URLSearchParams(value.split("?")[1] ?? "");
  return query.get("signin") === "1" ? destination : null;
}

export function initialSignInReturn(current: string, remembered: string | null): string {
  return explicitSignInReturn(current) ?? (remembered ? safeSignInReturn(remembered) : null) ?? safeSignInReturn(current) ?? "/";
}


/** Callback entry is not a redirect destination; its query is never persisted. */
export function isSignInCallback(value: string): boolean {
  return value.replace(/^#/, "").split("?")[0] === "/sign-in/sso-callback";
}


export function callbackSignInReturn(remembered: string | null, current: string): string {
  return (remembered ? safeSignInReturn(remembered) : null) ?? safeSignInReturn(current) ?? "/";
}

export function initialSignInActive(current:string,remembered:string|null):boolean{return explicitSignInReturn(current)!==null||isSignInCallback(current)||(remembered!==null&&safeSignInReturn(remembered)!==null);}
