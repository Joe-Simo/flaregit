/** F05 slice: issue form templates. Required fields are validated and unknown fields are rejected. */

export type TemplateField =
  | {readonly id: string; readonly type: "text"; readonly required: boolean}
  | {readonly id: string; readonly type: "dropdown"; readonly required: boolean; readonly options: readonly string[]}
  | {readonly id: string; readonly type: "checkbox"; readonly required: boolean};

export interface IssueTemplate {
  readonly name: string;
  readonly fields: readonly TemplateField[];
}

export type FieldValue = string | boolean;

export interface FieldError {
  readonly field: string;
  readonly error: string;
}

export type SubmissionResult =
  | {readonly ok: true; readonly values: Readonly<Record<string, FieldValue>>}
  | {readonly ok: false; readonly errors: readonly FieldError[]};

/** Checks that a template itself is well formed: a name, at least one field, unique ids, and non-empty dropdown options. */
export function validateTemplate(template: IssueTemplate): readonly string[] {
  const problems: string[] = [];
  if (template.name.trim().length === 0) problems.push("A template needs a name");
  if (template.fields.length === 0) problems.push("A template needs at least one field");
  const ids = new Set<string>();
  for (const field of template.fields) {
    if (field.id.trim().length === 0) problems.push("A field needs an id");
    if (ids.has(field.id)) problems.push(`Duplicate field id: ${field.id}`);
    ids.add(field.id);
    if (field.type === "dropdown" && field.options.length === 0) problems.push(`Dropdown ${field.id} needs options`);
  }
  return problems;
}

/** Validates a submission against a template. Unknown fields, wrong types, missing required fields and invalid options are all reported. */
export function validateSubmission(template: IssueTemplate, submitted: Readonly<Record<string, unknown>>): SubmissionResult {
  const errors: FieldError[] = [];
  const known = new Map(template.fields.map((field) => [field.id, field]));
  for (const key of Object.keys(submitted)) {
    if (!known.has(key)) errors.push({field: key, error: "Unknown field"});
  }
  const values: Record<string, FieldValue> = {};
  for (const field of template.fields) {
    const value = submitted[field.id];
    if (value === undefined || value === null) {
      if (field.required) errors.push({field: field.id, error: "This field is required"});
      continue;
    }
    if (field.type === "checkbox") {
      if (typeof value !== "boolean") errors.push({field: field.id, error: "Must be true or false"});
      else if (field.required && !value) errors.push({field: field.id, error: "This field is required"});
      else values[field.id] = value;
      continue;
    }
    if (typeof value !== "string") {
      errors.push({field: field.id, error: "Must be text"});
      continue;
    }
    const text = value.trim();
    if (text.length === 0) {
      if (field.required) errors.push({field: field.id, error: "This field is required"});
      continue;
    }
    if (field.type === "dropdown" && !field.options.includes(text)) {
      errors.push({field: field.id, error: "Not one of the allowed options"});
      continue;
    }
    values[field.id] = text;
  }
  return errors.length > 0 ? {ok: false, errors} : {ok: true, values};
}
