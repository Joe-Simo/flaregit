import {recordedAcceptedCommit} from "../accepted-commit-display";
import React, { useEffect, useRef, useState } from "react";
import { Monitor } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiJson } from "../api";
import { preservePreviewLink } from "../preview-display";

type GenerationRecovery = { canRecover: boolean; expectedGeneration: string | null; detail: string };
import { generationRecoveryDraft, requestGenerationRecovery, type RecoveryDraft } from "../preview-generation-recovery";
type PreviewStatus = { ready: true; status: "available"; url: string; expiresAt?: string; generationId?: string; generationRecovery?: GenerationRecovery; replacement?: { generationId: string; status: "requested" | "building" | "failed" | "quarantined" | "ready" } } | { ready: false; status: "failed" | "unavailable" | "pending" | "not_started"; canRetry: boolean; reason?: string; generationRecovery?: GenerationRecovery };
interface LivePreviewProps { projectId: string; currentCommit: string|null; isOwner?: boolean }

/** The accepted artifact and its preparation state are separate from repository review. */
export function LivePreview(props:LivePreviewProps){if(!recordedAcceptedCommit(props.currentCommit))return null;return <CommittedLivePreview key={`${props.projectId}:${props.currentCommit}`} {...props} currentCommit={props.currentCommit}/>;}
function CommittedLivePreview({ projectId, currentCommit, isOwner = false }: Omit<LivePreviewProps,"currentCommit">&{currentCommit:string}) {
  const scope = `${projectId}:${currentCommit}`;
  const [result, setResult] = useState<{ scope: string; preview: PreviewStatus } | null>(null);
  const displayedResult = useRef<{ scope: string; preview: PreviewStatus } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; reason: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [checking, setChecking] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const refreshLinkRequested = useRef(false);
  const refreshLink = () => { refreshLinkRequested.current = true; setRevision((value) => value + 1); };
  const recoveryDraft = useRef<RecoveryDraft | null>(null);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [notice, setNotice] = useState<string | null>(null);
  const [pollLimit, setPollLimit] = useState(false);
  const preview = result?.scope === scope ? result.preview : null;
  const error = failure?.scope === scope ? failure.reason : null;
  useEffect(() => {
    let active = true, attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setResult((previous) => previous?.scope === scope ? previous : null); setFailure(null); setPollLimit(false);
    const check = async () => {
      setChecking(true);
      try {
        const response = await apiJson<PreviewStatus>(`/p/${projectId}/preview?commit=${currentCommit}`, { signal: controller.signal });
        if (!active) return;
        const forceRefresh = refreshLinkRequested.current;
        refreshLinkRequested.current = false;
        const previous = displayedResult.current;
        const displayed = response.ready ? preservePreviewLink(previous?.scope === scope && previous.preview.ready ? previous.preview : null, response, forceRefresh) : response;
        displayedResult.current = { scope, preview: displayed };
        setResult(displayedResult.current);
        // Failed/unavailable builds are terminal until an explicit owner request.
        if ((!response.ready && (response.status === "pending" || response.status === "not_started")) || (response.ready && (response.replacement?.status === "requested" || response.replacement?.status === "building"))) {
          if (++attempts < 90) timer = setTimeout(() => void check(), 4000);
          else setPollLimit(true);
        } else if (displayed.ready && displayed.expiresAt) {
          const remaining = Date.parse(displayed.expiresAt) - Date.now() - 30_000;
          if (Number.isFinite(remaining) && ++attempts < 90) timer = setTimeout(() => void check(), Math.max(4000, remaining));
          else setPollLimit(true);
        }
      } catch (cause) { if (active) setFailure({ scope, reason: cause instanceof Error ? cause.message : "Preview status is unknown. Check again when the service is available." }); }
      finally { if (active) setChecking(false); }
    };
    void check();
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [projectId, currentCommit, scope, revision]);
  useEffect(() => { setNotice(null); setRetrying(false); }, [scope]);
  const retry = async () => {
    setRetrying(true); setFailure(null); setNotice(null);
    try {
      await apiJson<{ status: "requested" }>(`/p/${projectId}/preview/retry`, { method: "POST", json: { commit: currentCommit } });
      setNotice("Preview retry requested for this accepted commit. Waiting for build status."); setRevision((value) => value + 1);
    } catch (cause) { setFailure({ scope, reason: cause instanceof Error ? cause.message : "Preview retry was not confirmed. Check the saved status before trying again." }); }
    finally { setRetrying(false); }
  };
  const recoverGeneration = async () => {
    const recovery = preview?.generationRecovery;
    if (!isOwner || !recovery?.canRecover || retrying) return;
    const draft = recoveryDraft.current;
    const request = generationRecoveryDraft(draft, scope, currentCommit, recovery.expectedGeneration);
    recoveryDraft.current = request;
    setRetrying(true); setFailure(null); setNotice(null);
    try {
      const confirmation = await requestGenerationRecovery(projectId, request);
      if (currentScope.current !== scope) return;
      if (confirmation.status === "forbidden" || confirmation.status === "conflict") {
        if (confirmation.status === "forbidden") recoveryDraft.current = null;
        setRevision((value) => value + 1);
        setNotice(confirmation.detail || (confirmation.status === "forbidden" ? "Owner access changed. Preview status is being refreshed." : "Replacement was not confirmed. Review the refreshed preview status."));
        return;
      }
      recoveryDraft.current = null;
      setNotice(confirmation.status === "requested" || confirmation.status === "building" ? "Replacement preview requested. Waiting for preparation status." : confirmation.status === "ready" ? "Replacement preview is ready. Refreshing its link." : "The saved replacement request is unavailable. Review the refreshed status before creating another replacement.");
      setRevision((value) => value + 1);
    } catch (cause) {
      if (currentScope.current === scope) setFailure({ scope, reason: cause instanceof Error ? cause.message : "Replacement request was not confirmed. Check status before trying again." });
    } finally { if (currentScope.current === scope) setRetrying(false); }
  };
  const title = error ? "Preview status unavailable" : preview?.ready ? "Accepted preview" : preview?.status === "failed" ? "Preview build failed" : preview?.status === "unavailable" ? "Preview unavailable" : preview?.status === "not_started" ? "Preview not started" : "Preview preparation pending";
  return <Card className="h-full flex flex-col overflow-hidden shadow-none">
    <CardHeader className="py-3 px-5 border-b border-border"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Monitor className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><CardTitle className="text-sm font-medium">Accepted application</CardTitle></div><Badge variant={preview?.ready ? "success" : "outline"}>{preview?.ready ? "Built from" : "Accepted"} {currentCommit.slice(0, 7)}</Badge></div></CardHeader>
    <CardContent className="p-0 flex-1">
      {preview?.ready ? <><iframe key={`${scope}:${preview.url}`} title={`Accepted build ${currentCommit.slice(0, 7)}`} src={preview.url} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" className="w-full min-h-[560px] border-0 bg-white" /><div className="border-t border-border px-4 py-2 space-y-2">{error && <p role="alert" className="text-xs text-muted-foreground">{error} Showing the last confirmed build; current preparation status is unknown.</p>}{preview.replacement && <p role="status" className="text-xs text-muted-foreground">{preview.replacement.status === "requested" || preview.replacement.status === "building" ? "Replacement preview is being prepared. Showing the previous build." : "Replacement preview did not complete. Showing the previous build."}</p>}<div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" disabled={checking || retrying} onClick={refreshLink}>Refresh preview link</Button>{isOwner && preview.generationRecovery?.canRecover && <Button size="sm" variant="outline" disabled={checking || retrying} onClick={() => void recoverGeneration()}>{retrying ? "Requesting…" : "Rebuild preview"}</Button>}</div>{isOwner && preview.generationRecovery?.canRecover && <p className="text-xs text-muted-foreground">{preview.generationRecovery.detail}</p>}{pollLimit && <p role="status" className="text-xs text-muted-foreground">Automatic status checks stopped. Refresh the preview link to check replacement progress.</p>}</div></> : <div className="min-h-[360px] flex items-center justify-center p-5"><div className="max-w-md space-y-3 text-sm"><h3 className="font-medium">{title}</h3><p role={error || preview?.status === "failed" ? "alert" : "status"} className="text-muted-foreground whitespace-pre-wrap break-words">{error ?? (preview && !preview.ready ? preview.reason : undefined) ?? "The accepted preview is not yet available. Its preparation status will appear here."}</p>{isOwner && preview && !preview.ready && preview.generationRecovery && <p className="text-xs text-muted-foreground">{preview.generationRecovery.detail}{preview.generationRecovery.canRecover && " The old upload reservation stays held until it settles. A replacement uses a separate storage allowance."}</p>}{pollLimit && <p className="text-xs text-muted-foreground">Automatic status checks stopped while preparation is still unresolved. Check again to read its current state.</p>}<p className="text-xs text-muted-foreground">Repository source, history, and human review remain available independently of this preview.</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={checking || retrying} onClick={() => setRevision((value) => value + 1)}>{checking ? "Checking…" : "Check preview status"}</Button>{isOwner && preview && !preview.ready && preview.canRetry && <Button size="sm" variant="outline" disabled={checking || retrying} onClick={() => void retry()}>{retrying ? "Requesting…" : "Retry preview"}</Button>}{isOwner && preview && !preview.ready && preview.generationRecovery?.canRecover && <Button size="sm" variant="outline" disabled={checking || retrying} onClick={() => void recoverGeneration()}>{retrying ? "Requesting…" : "Create replacement preview"}</Button>}</div></div></div>}
      {notice && <p role="status" className="px-4 py-3 text-xs text-muted-foreground">{notice}</p>}
    </CardContent>
  </Card>;
}
