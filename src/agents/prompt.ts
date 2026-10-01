import type { Task } from "../core/types.js";

const matches = (file: string, patterns: readonly string[]) =>
  patterns.some((p) => (p.endsWith("/") ? file.startsWith(p) : p.endsWith("/**/*") ? file.startsWith(p.slice(0, -4)) : file === p));

export function inAgentScope(task: Pick<Task, "allowedScope">, file: string): boolean {
  return matches(file, task.allowedScope);
}

export function isProtectedPath(file: string, protectedPaths: readonly string[]): boolean {
  return matches(file, protectedPaths);
}

/** Prompt shared by the local and cloud agents. `files` are the current in-scope source files. */
export function buildAgentPrompt(task: Task, agentName: string, files: Record<string, string>): string {
  const requirements = task.requirements.map((r) => `- ${r.title}: ${r.description}`).join("\n");
  const context = Object.entries(files)
    .map(([f, c]) => `<current path="${f}">\n${c}\n</current>`)
    .join("\n");
  return [
    `You are ${agentName}, a coding agent working in an isolated git workspace.`,
    `Task: ${task.goal}`,
    requirements ? `Requirements:\n${requirements}` : "",
    `You may only change: ${task.allowedScope.join(", ")}.`,
    "Implement the task by rewriting whole files. Keep every existing behavior that the task does not change.",
    "Do not touch tests, CI, package manifests or verification config. Import every type you use; do not invent types or exports.",
    "",
    context,
    "",
    'Reply with the COMPLETE new content of every file you change, each as: <file path="PATH">\\nCONTENT\\n</file>.',
  ].join("\n");
}

/** Throws if the model proposed a write outside the task's scope or onto protected paths. */
export function assertAgentWrites(task: Pick<Task, "allowedScope">, files: Iterable<string>, protectedPaths: readonly string[]): void {
  for (const file of files) {
    if (file.startsWith("/") || file.split("/").includes("..")) throw new Error(`Path escapes workspace: ${file}`);
    if (!inAgentScope(task, file)) throw new Error(`${file} is outside the task scope`);
    if (isProtectedPath(file, protectedPaths)) throw new Error(`${file} is protected`);
  }
}
