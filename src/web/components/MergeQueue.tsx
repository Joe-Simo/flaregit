import React, { useMemo, useState } from "react";
import { ListOrdered } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { FlareGitProjectState, Task } from "@/core/types";
import { apiJson } from "../api";
import { agentRunFailed, canRunAgentAgain, nextTryText, QUEUE_STATUS, UPDATE_STATUS, type CoordinationView, type UpdateView } from "../coordination";

/**
 * Latest post-land update of one change, shown on the change and in the queue. When the agent's re-run
 * was refused, an owner can send the same re-run again; the server refuses with a reason if it still cannot run.
 */
export function ChangeUpdateStatus({ update, task, projectId, isOwner = false, onChange }: { update: UpdateView | undefined; task?: Task; projectId?: string; isOwner?: boolean; onChange?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  if (!update) return null;
  const status = UPDATE_STATUS[update.status];
  const retryable = canRunAgentAgain(update, task), failed = agentRunFailed(update, task);
  const runAgain = async () => {
    if (!projectId) return;
    setBusy(true); setMessage(null);
    try {
      const result = await apiJson<{ dispatched: boolean; replayed: boolean; update: UpdateView }>(`/p/${encodeURIComponent(projectId)}/changes/run-agent-again`, { method: "POST", json: { taskId: update.taskId } });
      if (result.dispatched) setMessage({ text: result.replayed ? "The agent is already running again on the latest version." : "The agent is running again on the latest version.", error: false });
      else setMessage({ text: result.update.reason || "The agent was not started. Pressing the button again is safe.", error: true });
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : "Running the agent again was not confirmed. Pressing the button again is safe.", error: true });
    } finally { setBusy(false); onChange?.(); }
  };
  const nextTry = retryable ? nextTryText(update) : null;
  return (
    <div className="mt-1 space-y-1 text-xs text-muted-foreground break-words">
      <p>
        <Badge variant={status.variant}>{status.label}</Badge> <span>{update.reason}</span>
        {update.overlappingFiles.length > 0 && <span> · Also changed by the landed work: {update.overlappingFiles.slice(0, 5).join(", ")}{update.overlappingFiles.length > 5 ? "…" : ""}</span>}
      </p>
      {failed && <p>The agent's last run on the latest version failed. Its saved work is kept.</p>}
      {retryable && !failed && update.retry && <p>Last refusal: {update.retry.refusedReason}{nextTry ? ` ${nextTry}` : ""}</p>}
      {retryable && isOwner && projectId && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void runAgain()}>{busy ? "Starting the agent…" : "Run the agent again on the latest version"}</Button>}
      {message && <p role={message.error ? "alert" : "status"} className={message.error ? "text-destructive" : undefined}>{message.text}</p>}
    </div>
  );
}

/**
 * Merge queue: ready changes land one at a time in queue order, each checked again on the latest accepted
 * version. Shows each change's position, status and the reason it is waiting or was refused.
 */
export function MergeQueue({ projectId, state, view, isOwner, canQueue, onChange }: {
  projectId: string;
  state: FlareGitProjectState;
  view: CoordinationView | null;
  isOwner: boolean;
  canQueue: boolean;
  onChange: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const active = useMemo(() => (view?.queue ?? []).filter((entry) => entry.status !== "landed" && entry.status !== "removed").sort((a, b) => a.position - b.position), [view]);
  const landed = useMemo(() => (view?.queue ?? []).filter((entry) => entry.status === "landed").slice(-5).reverse(), [view]);
  const updates = useMemo(() => new Map((view?.updates ?? []).map((update) => [update.taskId, update])), [view]);
  const queuedIds = new Set(active.map((entry) => entry.taskId));
  const ready = Object.values(state.tasks).filter((task) => task.status === "ready" && !queuedIds.has(task.id) && !task.acceptedTarget && !task.targetGeneration && task.currentCommit);
  const titleId = `merge-queue-${projectId}`;

  const enqueue = async () => {
    if (!selected.length) return;
    setBusy("enqueue"); setError(null);
    try {
      await apiJson(`/p/${encodeURIComponent(projectId)}/merge-queue`, { method: "POST", json: { requestId, taskIds: selected } });
      setSelected([]); setRequestId(crypto.randomUUID());
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "Queueing was not confirmed"} Pressing the button again resends the same request.`);
    } finally { setBusy(null); onChange(); }
  };
  const remove = async (taskId: string) => {
    setBusy(`remove-${taskId}`); setError(null);
    try { await apiJson(`/p/${encodeURIComponent(projectId)}/merge-queue/remove`, { method: "POST", json: { taskId } }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Removal was not confirmed"); }
    finally { setBusy(null); onChange(); }
  };

  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-border p-3 space-y-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <ListOrdered className="h-4 w-4" aria-hidden="true" />
        <h2 id={titleId} className="text-sm font-semibold">Merge queue ({active.length})</h2>
        <p className="text-xs text-muted-foreground">Changes land one at a time, in order, each checked again on the latest version.</p>
      </div>
      {error && <p role="alert" className="text-xs text-destructive break-words">{error}</p>}
      {!view ? <p className="text-xs text-muted-foreground">Loading the queue…</p> : active.length === 0 ? <p className="text-xs text-muted-foreground">No change is queued.</p> : (
        <ol className="space-y-2">
          {active.map((entry, index) => {
            const status = QUEUE_STATUS[entry.status];
            // The server also lets the person who queued a change remove it; it refuses anyone else.
            const canRemove = canQueue && (entry.status !== "landing" || isOwner);
            return (
              <li key={entry.taskId} className="rounded-md border border-border/60 p-2 text-sm min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground" aria-label={`Position ${index + 1}`}>#{index + 1}</span>
                  <span className="break-words min-w-0 flex-1">{entry.goal}</span>
                  <Badge variant={status.variant}>{status.label}</Badge>
                  {canRemove && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void remove(entry.taskId)} aria-label={`Remove “${entry.goal}” from the queue`}>{busy === `remove-${entry.taskId}` ? "Removing…" : "Remove"}</Button>}
                </div>
                {entry.reason && <p className="mt-1 text-xs text-muted-foreground break-words">{entry.reason}</p>}
                <ChangeUpdateStatus update={updates.get(entry.taskId)} task={state.tasks[entry.taskId]} projectId={projectId} isOwner={isOwner} onChange={onChange} />
              </li>
            );
          })}
        </ol>
      )}
      {landed.length > 0 && <p className="text-xs text-muted-foreground break-words">Recently landed from the queue: {landed.map((entry) => entry.goal).join(" · ")}</p>}
      {canQueue && ready.length > 0 && (
        <fieldset className="space-y-2 border-t border-border pt-3">
          <legend className="text-xs font-medium">Ready changes</legend>
          {ready.map((task) => (
            <div key={task.id} className="flex items-center gap-2 text-sm">
              <Checkbox id={`queue-${task.id}`} checked={selected.includes(task.id)} onCheckedChange={(checked) => { setRequestId(crypto.randomUUID()); setSelected((current) => checked === true ? [...current.filter((id) => id !== task.id), task.id] : current.filter((id) => id !== task.id)); }} />
              <label htmlFor={`queue-${task.id}`} className="break-words min-w-0">{task.goal}</label>
            </div>
          ))}
          <Button size="sm" disabled={!selected.length || busy !== null} onClick={() => void enqueue()}>{busy === "enqueue" ? "Queueing…" : `Queue ${selected.length || ""} in this order`.replace("  ", " ")}</Button>
        </fieldset>
      )}
    </section>
  );
}
