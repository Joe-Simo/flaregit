import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { REQUIREMENT_LIMITS } from "@/core/requirement-drafts";
import { emptyRequirementRow, type RequirementRow } from "../requirement-form";

const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Optional requirements for a new change. Stays collapsed until the person chooses to add one. */
export function RequirementsEditor({ rows, onChange, disabled, idPrefix }: { rows: RequirementRow[]; onChange: (rows: RequirementRow[]) => void; disabled: boolean; idPrefix: string }) {
  const update = (key: string, patch: Partial<RequirementRow>) => onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  if (rows.length === 0)
    return (
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange([emptyRequirementRow()])}>
        <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" /> Add requirements
      </Button>
    );
  return (
    <section aria-labelledby={`${idPrefix}-requirements`} className="space-y-3 border-t border-border pt-3">
      <div>
        <h3 id={`${idPrefix}-requirements`} className="text-sm font-medium">Requirements</h3>
        <p className="text-xs text-muted-foreground">What must be true when this change is done. Add an example FlareGit can run to check it.</p>
      </div>
      <ol className="space-y-4">
        {rows.map((row, index) => {
          const id = `${idPrefix}-requirement-${index + 1}`;
          return (
            <li key={row.key} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <label htmlFor={`${id}-title`} className="sr-only">Requirement {index + 1} title</label>
                <Input id={`${id}-title`} disabled={disabled} value={row.title} maxLength={REQUIREMENT_LIMITS.title} placeholder="Short title, e.g. Group discount" onChange={(event) => update(row.key, { title: event.target.value })} />
                <Button size="sm" variant="ghost" disabled={disabled} aria-label={`Remove requirement ${index + 1}`} onClick={() => onChange(rows.filter((item) => item.key !== row.key))}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
              <label htmlFor={`${id}-statement`} className="sr-only">Requirement {index + 1} statement</label>
              <textarea id={`${id}-statement`} disabled={disabled} value={row.statement} rows={2} maxLength={REQUIREMENT_LIMITS.statement} placeholder="In plain words, e.g. Orders of 4 or more tickets get 15% off" className={field} onChange={(event) => update(row.key, { statement: event.target.value })} />
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" disabled={disabled} checked={row.withExample} onChange={(event) => update(row.key, { withExample: event.target.checked })} />
                Add an example FlareGit can run
              </label>
              {row.withExample && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-xs text-muted-foreground space-y-1">
                    <span>File in the repository</span>
                    <Input disabled={disabled} value={row.module} maxLength={200} placeholder="src/pricing.ts" onChange={(event) => update(row.key, { module: event.target.value })} />
                  </label>
                  <label className="text-xs text-muted-foreground space-y-1">
                    <span>Exported function to call</span>
                    <Input disabled={disabled} value={row.exportName} maxLength={101} placeholder="calculateQuote" onChange={(event) => update(row.key, { exportName: event.target.value })} />
                  </label>
                  <label className="text-xs text-muted-foreground space-y-1">
                    <span>Example input (JSON object)</span>
                    <textarea disabled={disabled} value={row.input} rows={2} maxLength={REQUIREMENT_LIMITS.json} placeholder='{"ticketCount": 4, "basePrice": 40}' className={`${field} font-mono`} onChange={(event) => update(row.key, { input: event.target.value })} />
                  </label>
                  <label className="text-xs text-muted-foreground space-y-1">
                    <span>Expected result (JSON)</span>
                    <textarea disabled={disabled} value={row.expectedOutput} rows={2} maxLength={REQUIREMENT_LIMITS.json} placeholder='{"total": 136}' className={`${field} font-mono`} onChange={(event) => update(row.key, { expectedOutput: event.target.value })} />
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {rows.length < REQUIREMENT_LIMITS.count && (
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange([...rows, emptyRequirementRow()])}>
          <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" /> Add another requirement
        </Button>
      )}
    </section>
  );
}
