import { useEffect, useRef, useState } from "react";
import { Pause, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiJson } from "../api";
import { timeAgo } from "../router";
import { availableWorkflowAction, checkedWorkflowObservation, WORKFLOW_STATUS_LABELS, type WorkflowObservation, type WorkflowRunAction, type SavedWorkflowDecision } from "../workflow-run-state";

export function WorkflowRunControls({ projectId, instanceId, kind = "integration", isOwner, onChange, savedDecision }: { projectId: string; instanceId: string; kind?: WorkflowObservation["kind"]; isOwner: boolean; onChange: () => void; savedDecision?: SavedWorkflowDecision | null }) {
 const [observation, setObservation] = useState<{ value: WorkflowObservation; at: string } | null>(null), [busy, setBusy] = useState<WorkflowRunAction | "decision" | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
 const controller = useRef<AbortController | null>(null), lock = useRef(false), generation = useRef(0);
 const decision = savedDecision?.workflowInstanceId === instanceId && kind === "integration" ? savedDecision : null;
 const scope = JSON.stringify([projectId, instanceId, kind, isOwner, decision]); const currentScope = useRef(scope); currentScope.current = scope;
 useEffect(() => { generation.current++; controller.current?.abort(); lock.current = false; setObservation(null); setError(""); setNotice(""); setBusy(null); return () => { generation.current++; controller.current?.abort(); }; }, [scope]);
 async function request(action: WorkflowRunAction | "decision") {
  if (lock.current || !isOwner || (action === "decision" && !decision)) return;
  const capturedScope = scope, capturedGeneration = generation.current;
  const valid = () => currentScope.current === capturedScope && generation.current === capturedGeneration;
  lock.current = true; const current = new AbortController(); controller.current = current; setBusy(action); setError(""); setNotice("");
  const timer = setTimeout(() => current.abort(new Error("Run response deadline reached")), 15_000);
  let deliveringDecision = action === "decision";
  try {
   let run: WorkflowObservation;
   if (action === "decision") {
    const raw = await apiJson<unknown>(`/p/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(instanceId)}`, { signal: current.signal });
    run = checkedWorkflowObservation(raw, instanceId, kind); if (run.action !== "status") throw new Error("Run response did not match this status request.");
   } else {
    const raw = await apiJson<unknown>(`/p/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(instanceId)}${action === "status" ? "" : `/${action}`}`, { method: action === "status" ? "GET" : "POST", signal: current.signal });
    run = checkedWorkflowObservation(raw, instanceId, kind); if (run.action !== action) throw new Error("Run response did not match this request.");
   }
   if (!valid() || current.signal.aborted) return;
   setObservation({ value: run, at: new Date().toISOString() });
   if (action !== "status" && action !== "decision") setNotice(run.changed ? `${action === "pause" ? "Pause" : "Resume"} requested. Current observed state: ${WORKFLOW_STATUS_LABELS[run.status]}.` : `This run is already ${WORKFLOW_STATUS_LABELS[run.status].toLowerCase()}; no new transition was requested.`);
   if (decision && (action === "resume" || action === "decision")) {
    if (!["running", "waiting", "queued"].includes(run.status)) { setNotice(`Saved ${decision.approved ? "approval" : "rejection"} has not been resent. The run is ${WORKFLOW_STATUS_LABELS[run.status].toLowerCase()}; check its state before continuing.`); onChange(); return; }
    deliveringDecision = true; setBusy("decision");
    const receipt = await apiJson<{ recorded: boolean; approved: boolean }>(`/p/${encodeURIComponent(projectId)}/candidates/${encodeURIComponent(decision.candidateId)}/review`, { method: "POST", signal: current.signal, json: { approved: decision.approved, note: decision.note, expectedCommit: decision.expectedCommit } });
    if (!valid() || current.signal.aborted) return;
    if (receipt.recorded !== true || receipt.approved !== decision.approved) throw new Error("Saved decision delivery was not confirmed.");
    setNotice(`Saved ${decision.approved ? "approval" : "rejection"} delivered to this same run. Delivery confirmation does not prove accepted repository history.`);
   }
   if (action !== "status") onChange();
  } catch { if (valid()) { setError(deliveringDecision ? "The saved decision remains recorded, but its delivery was not confirmed. Check the run, then retry the same saved decision." : action === "status" ? "Current run status could not be confirmed. Refresh to try again." : `${action === "pause" ? "Pause" : "Resume"} result is unknown. Check the run before repeating this action; do not start a replacement run.`); if (deliveringDecision) onChange(); } }
  finally { clearTimeout(timer); if (valid()) { lock.current = false; controller.current = null; setBusy(null); } }
 }
 if (!isOwner) return null;
 const status = observation?.value.status, action = error ? null : availableWorkflowAction(status);
 const canDeliver = !error && decision && status && ["running", "waiting", "queued"].includes(status);
 return <section className="mt-3 border-t border-border pt-3 space-y-2" aria-label={`${kind === "integration" ? "Integration" : "Saved"} workflow controls`}><div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">Saved run · {status ? WORKFLOW_STATUS_LABELS[status] : "Status not checked"}{observation ? ` · checked ${timeAgo(observation.at)}` : ""}</span><Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void request("status")}><RefreshCw className="h-3.5 w-3.5 mr-1" aria-hidden />{busy === "status" ? "Checking…" : "Check run"}</Button>{action && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void request(action)}>{action === "pause" ? <Pause className="h-3.5 w-3.5 mr-1" aria-hidden /> : <Play className="h-3.5 w-3.5 mr-1" aria-hidden />}{busy === action ? action === "pause" ? "Requesting pause…" : "Resuming…" : action === "pause" ? "Pause run" : decision ? "Resume & resend saved decision" : "Resume saved run"}</Button>}{canDeliver && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void request("decision")}>{busy === "decision" ? "Delivering…" : `Resend saved ${decision.approved ? "approval" : "rejection"}`}</Button>}</div>{status === "waitingForPause" && <p className="text-xs text-muted-foreground">Pause is pending. Work may continue until the workflow confirms it is paused. Check the run again.</p>}{status === "paused" && <p className="text-xs text-muted-foreground">Resume continues this same durable run. Its recorded inputs, decisions and checkpoints remain available for review.</p>}{decision && <p className="text-xs text-muted-foreground">Saved {decision.approved ? "approval" : "rejection"} for <code>{decision.expectedCommit.slice(0, 12)}</code>. Recovery resends the original decision and note; it does not create a new review.</p>}{notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</section>;
}
