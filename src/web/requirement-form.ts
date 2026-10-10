import { requirementDraftsSchema, type RequirementDraft } from "@/core/requirement-drafts";

/** What a person types for one requirement; examples are written as JSON text. */
export interface RequirementRow {
  key: string;
  title: string;
  statement: string;
  withExample: boolean;
  module: string;
  exportName: string;
  input: string;
  expectedOutput: string;
}

export function emptyRequirementRow(): RequirementRow {
  return { key: crypto.randomUUID(), title: "", statement: "", withExample: false, module: "", exportName: "", input: "", expectedOutput: "" };
}

export function rowsFromDrafts(drafts: readonly RequirementDraft[] | undefined): RequirementRow[] {
  return (drafts ?? []).map((draft) => ({
    ...emptyRequirementRow(),
    title: draft.title,
    statement: draft.statement,
    withExample: draft.example !== undefined,
    module: draft.example?.module ?? "",
    exportName: draft.example?.export ?? "",
    input: draft.example ? JSON.stringify(draft.example.input) : "",
    expectedOutput: draft.example ? JSON.stringify(draft.example.expectedOutput) : "",
  }));
}

function parseJson(text: string, label: string, position: number): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Requirement ${position}: the ${label} is not valid JSON.`);
  }
}

/**
 * Turns the rows into requirements to send with the change. Blank rows are skipped; anything half filled
 * in is reported in plain language. Returns undefined when there are none.
 */
export function draftsFromRows(rows: readonly RequirementRow[]): RequirementDraft[] | undefined {
  const filled = rows.filter((row) => row.title.trim() || row.statement.trim() || (row.withExample && (row.module.trim() || row.exportName.trim() || row.input.trim() || row.expectedOutput.trim())));
  if (filled.length === 0) return undefined;
  const drafts = filled.map((row, index) => {
    const position = index + 1;
    if (!row.title.trim() || !row.statement.trim()) throw new Error(`Requirement ${position} needs a title and a statement.`);
    if (!row.withExample) return { title: row.title.trim(), statement: row.statement.trim() };
    const input = parseJson(row.input, "example input", position);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`Requirement ${position}: the example input must be a JSON object, like {"ticketCount": 4}.`);
    return { title: row.title.trim(), statement: row.statement.trim(), example: { module: row.module.trim(), export: row.exportName.trim(), input: input as Record<string, unknown>, expectedOutput: parseJson(row.expectedOutput, "expected result", position) } };
  });
  const parsed = requirementDraftsSchema.safeParse(drafts);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const position = typeof issue?.path[0] === "number" ? issue.path[0] + 1 : null;
    const field = issue?.path.includes("module") ? "the file must be a path inside the repository, like src/pricing.ts" : issue?.path.includes("export") ? "the function name must be a plain name, like calculateQuote" : issue?.message ?? "check its fields";
    throw new Error(position === null ? `Add at most 8 requirements.` : `Requirement ${position}: ${field}.`);
  }
  return parsed.data;
}
