import { z } from "zod";
import type { Requirement } from "./types.js";

/**
 * Requirements a person writes when starting a change. They become approved `Requirement`s on the task,
 * and an example with a function to call lets FlareGit run the code to check (or prove a contradiction).
 *
 * The exported function FlareGit runs for an example: a repo-relative source file and an identifier. */
export const requirementProbeSchema = z
  .object({
    module: z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9_./-]{1,200}\.(?:ts|tsx|js|mjs)$/),
    export: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,100}$/),
  })
  .strict();

export const REQUIREMENT_LIMITS = { count: 8, title: 120, statement: 1000, json: 4000 } as const;

const boundedJson = <T extends z.ZodType>(schema: T) =>
  schema.refine((value) => (JSON.stringify(value) ?? "").length <= REQUIREMENT_LIMITS.json, `Keep examples under ${REQUIREMENT_LIMITS.json} characters`);

export const requirementExampleSchema = z
  .object({
    module: requirementProbeSchema.shape.module,
    export: requirementProbeSchema.shape.export,
    input: boundedJson(z.record(z.string(), z.json())),
    expectedOutput: boundedJson(z.json()),
  })
  .strict();

export const requirementDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(REQUIREMENT_LIMITS.title),
    statement: z.string().trim().min(1).max(REQUIREMENT_LIMITS.statement),
    example: requirementExampleSchema.optional(),
  })
  .strict();

export const requirementDraftsSchema = z.array(requirementDraftSchema).min(1).max(REQUIREMENT_LIMITS.count);
export type RequirementDraft = z.infer<typeof requirementDraftSchema>;

/** Same matching rules as a change's allowed scope ("*", "dir/", "dir/**\/*" or an exact file). */
export function pathInScope(scope: readonly string[], path: string): boolean {
  if (scope.length === 0) return true;
  return scope.some((entry) => entry === "*" || (entry.endsWith("/**/*") ? path.startsWith(entry.slice(0, -4)) : entry.endsWith("/") ? path.startsWith(entry) : path === entry));
}

/** Deterministic: the same drafts, change and time always produce the same requirements, so retries replay exactly. */
export function requirementsFromDrafts(taskId: string, drafts: readonly RequirementDraft[], approvedAt: string): Requirement[] {
  return drafts.map((draft, index) => {
    const id = `REQ-${taskId}-${index + 1}`;
    return {
      id,
      title: draft.title,
      description: draft.statement,
      version: 1,
      status: "approved",
      originTaskId: taskId,
      approvedAt,
      assertions: draft.example
        ? [{ id: `${id}-example`, description: draft.statement, input: structuredClone(draft.example.input), expectedOutput: structuredClone(draft.example.expectedOutput), probe: { module: draft.example.module, export: draft.example.export } }]
        : [],
    };
  });
}

/** One prompt line per requirement, with any runnable example the agent's code must satisfy. */
export function requirementPromptLine(requirement: Pick<Requirement, "title" | "description"> & { assertions?: Requirement["assertions"] }): string {
  const examples = (requirement.assertions ?? [])
    .filter((assertion) => assertion.probe && assertion.input !== undefined && assertion.expectedOutput !== undefined)
    .map((assertion) => `\n  Example FlareGit runs: ${assertion.probe!.export}(${JSON.stringify(assertion.input)}) from ${assertion.probe!.module} must return ${JSON.stringify(assertion.expectedOutput)}`);
  return `- ${requirement.title}: ${requirement.description}${examples.join("")}`;
}
