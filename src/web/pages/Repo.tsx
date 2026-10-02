import React, { useCallback, useEffect, useState } from "react";
import { Copy, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { apiJson } from "../api";
import { navigate } from "../router";
import { CodeTab } from "../tabs/Code";
import { CommitsTab } from "../tabs/Commits";
import { ChangesTab } from "../tabs/Changes";
import { IntegrationTab } from "../tabs/Integration";
import { ActivityTab } from "../tabs/Activity";
import { ReviewTab } from "../tabs/Review";
import { IssuesTab } from "../tabs/Issues";
import { PeopleTab } from "../tabs/People";
import { SettingsTab } from "../tabs/Settings";
import type { FlareGitProjectState } from "@/core/types";

interface Meta { id: string; role: "owner" | "member"; kind: string; name: string; source: string | null; verification: Record<string, unknown>; protectedPaths: string[] }
type State = FlareGitProjectState & { role: string };

const TABS = [
  ["code", "Code"],
  ["commits", "Commits"],
  ["issues", "Issues"],
  ["changes", "Changes"],
  ["integration", "Integration"],
  ["people", "People"],
  ["activity", "Activity"],
  ["settings", "Settings"],
] as const;

export function Repo({ projectId, tab, previewBase, params }: { projectId: string; tab: string; previewBase: string; params: URLSearchParams }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clone, setClone] = useState<{ command: string; remote: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(() => {
    apiJson<Meta>(`/p/${projectId}`).then(setMeta).catch((e: Error) => setError(e.message));
    apiJson<State>(`/p/${projectId}/state`).then(setState).catch(() => undefined);
  }, [projectId]);

  useEffect(() => {
    reload();
    const t = setInterval(() => apiJson<State>(`/p/${projectId}/state`).then(setState).catch(() => undefined), 6000);
    return () => clearInterval(t);
  }, [projectId, reload]);

  if (error) return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 text-sm text-destructive" role="alert">{error === "Not found" ? "Repository not found, or you don't have access." : error}</div>;
  if (!meta || !state) return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 text-sm text-muted-foreground">Loading repository…</div>;

  const getClone = async () => {
    const r = await apiJson<{ command: string; remote: string }>(`/p/${projectId}/clone`, { method: "POST" });
    setClone(r);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-lg font-bold truncate">{meta.name}</h1>
          <Badge variant="outline">private</Badge>
          {meta.role === "member" && <Badge variant="secondary">collaborator</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">head {state.acceptedState.currentCommit.slice(0, 7)}</span>
          <Button size="sm" variant="outline" onClick={getClone}>Clone</Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border mb-5 overflow-x-auto" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => navigate(`/p/${projectId}/${key}`)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === key ? "border-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "code" && <CodeTab projectId={projectId} />}
      {tab === "commits" && <CommitsTab projectId={projectId} />}
      {tab === "changes" && <ChangesTab projectId={projectId} state={state} reload={reload} />}
      {tab === "integration" && <IntegrationTab projectId={projectId} state={state} previewBase={previewBase} reload={reload} kind={meta.kind} />}
      {tab === "activity" && <ActivityTab projectId={projectId} />}
      {tab === "issues" && <IssuesTab projectId={projectId} issue={params.get("n") ? Number(params.get("n")) : undefined} />}
      {tab === "people" && <PeopleTab projectId={projectId} />}
      {tab === "review" && <ReviewTab projectId={projectId} task={params.get("task") ?? undefined} candidate={params.get("candidate") ? state.candidates[params.get("candidate")!] : undefined} evidence={state} reload={reload} />}
      {tab === "commit" && <ReviewTab projectId={projectId} commit={params.get("hash") ?? undefined} />}
      {tab === "settings" && <SettingsTab meta={meta} reload={reload} />}

      <Dialog open={clone !== null} onOpenChange={() => setClone(null)}>
        <DialogHeader>
          <DialogTitle>Clone with Git</DialogTitle>
          <DialogDescription>Read-only credential, valid for one hour. To contribute, start a change and push to its own copy.</DialogDescription>
        </DialogHeader>
        <pre className="text-xs bg-muted/40 rounded-md p-3 overflow-auto whitespace-pre-wrap break-all">{clone?.command}</pre>
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(clone?.command ?? ""); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            <Copy className="h-4 w-4 mr-1.5" /> {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="orange" onClick={() => setClone(null)}>Done</Button>
        </div>
      </Dialog>
    </div>
  );
}
