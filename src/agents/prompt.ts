import type { Task } from "../core/types.js";

const matches = (file: string, patterns: readonly string[]) =>
  patterns.some((p) => p === "*" || (p.endsWith("/") ? file.startsWith(p) : p.endsWith("/**/*") ? file.startsWith(p.slice(0, -4)) : file === p));

export function inAgentScope(task: Pick<Task, "allowedScope">, file: string): boolean {
  return matches(file, task.allowedScope);
}

export function isProtectedPath(file: string, protectedPaths: readonly string[]): boolean {
  return matches(file, protectedPaths);
}

/** Prompt shared by the local and cloud agents. `files` are the current in-scope source files. */
/** Common credential shapes. Matches are replaced before any text reaches a model. */
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk-(?:live|test|proj|ant)?[-_]?[A-Za-z0-9]{20,}\b/g,
  /\bfgt_[0-9a-f]{12}_[A-Za-z0-9]{32,64}\b/g,
  /\bfgg_p?[0-9a-f]{12}_[A-Za-z0-9_-]{32,128}\b/g,
  /\bart_v1_[A-Za-z0-9_-]{16,}(?:\?expires=\d+)?/g,
  /(\bBearer\s+)[A-Za-z0-9._~+\/-]{16,}=*/gi,
  /\bwhsec_[A-Za-z0-9+/=]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // Literal credential values only: expressions such as password: input.password
  // are ordinary code and must not be mistaken for embedded credentials.
  /((?:["']?(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)["']?)\s*[:=]\s*)["'][^\r\n"']{8,}["']/gi,
  /(^[ \t]*(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*=\s*)[A-Za-z0-9_./+?=&-]{8,}[ \t]*$/gim,
  /(^[ \t]*(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*:\s*)[A-Za-z0-9_+\/?=&-]{8,}[ \t]*$/gim,
];
export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((t, re) => t.replace(re, (m, prefix?: string) => (typeof prefix === "string" && m.startsWith(prefix) ? `${prefix}[REDACTED]` : "[REDACTED]")), text);
}

export function buildAgentPrompt(task: Task, agentName: string, files: Record<string, string>, checkCommand?: string, shared?: string): string {
  const requirements = task.requirements.filter((r) => r.status === "approved").map((r) => `- ${r.title}: ${r.description}`).join("\n");
  // A maintainer chose another requirement over these; the change must stop implementing them.
  const superseded = task.requirements.filter((r) => r.status === "superseded").map((r) => `- ${r.title}: ${r.description}`).join("\n");
  const context = Object.entries(files)
    .map(([f, c]) => `<current path="${f}">\n${redactSecrets(c)}\n</current>`)
    .join("\n");
  return redactSecrets([
    `You are ${agentName}, a coding agent working in an isolated git workspace.`,
    `Task: ${task.goal}`,
    requirements ? `Requirements:\n${requirements}` : "",
    superseded ? `No longer required (a maintainer chose a conflicting requirement instead; remove this behavior if your change implements it):\n${superseded}` : "",
    shared ? `Shared context from the people on this change (issue, review comments, earlier progress):\n${redactSecrets(shared)}` : "",
    `You may only change: ${task.allowedScope.map((x) => (x === "*" ? "any source file" : x)).join(", ")}.`,
    checkCommand ? `Your change is only accepted if the project's protected check passes: ${checkCommand}` : "",
    "Implement the task by rewriting whole files. Keep every existing behavior that the task does not change.",
    "Do not touch tests, CI, package manifests or verification config. Import every type you use; do not invent types or exports.",
    "",
    context,
    "",
    'Reply with the COMPLETE new content of every file you change, each as: <file path="PATH">\\nCONTENT\\n</file>.',
  ].join("\n"));
}

/** Throws if the model proposed a write outside the task's scope or onto protected paths. */
export function assertAgentWrites(task: Pick<Task, "allowedScope">, files: Iterable<string>, protectedPaths: readonly string[]): void {
  for (const file of files) {
    if (!file || /[\x00-\x1f\\]/.test(file) || file.startsWith("/") || file.split("/").some((part) => part === ".." || part === ".git" || part === "" || part === ".")) throw new Error(`Path escapes workspace: ${file}`);
    if (!inAgentScope(task, file)) throw new Error(`${file} is outside the task scope`);
    if (isProtectedPath(file, protectedPaths)) throw new Error(`${file} is protected`);
  }
}
