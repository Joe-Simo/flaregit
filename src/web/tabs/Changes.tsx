import React, { useState } from "react";
import { Bot, Check, Copy, GitPullRequestArrow, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { apiJson } from "../api";
import { navigate, timeAgo } from "../router";
import type { FlareGitProjectState, Task, TaskStatus } from "@/core/types";

const STATUS: Record<TaskStatus, { label: string; variant: "secondary" | "info" | "warning" | "success" | "purple" | "destructive" | "outline" }> = {
  working: { label: "Working", variant: "secondary" },
  checkpointed: { label: "Working · pushed", variant: "secondary" },
  ready: { label: "Ready", variant: "info" },
  integrating: { label: "Integrating", variant: "warning" },
  verifying: { label: "Verifying", variant: "warning" },
  accepted: { label: "Accepted", variant: "success" },
  needs_decision: { label: "Needs decision", variant: "purple" },
  blocked: { label: "Blocked", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

const slug = (goal: string) => goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "change";

export function ChangesTab({ projectId, state, reload }: { projectId: string; state: FlareGitProjectState; reload: () => void }) {
  const [goal, setGoal] = useState("");
  const [useAgent, setUseAgent] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [instructions, setInstructions] = useState<{ commands: string[]; task: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const tasks = Object.values(state.tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
      reload();
    }
  };

  const create = () =>
    run("create", async () => {
      const taskId = `${slug(goal)}-${Math.random().toString(36).slice(2, 6)}`;
      const created = await apiJson<{ commands: string[] }>(`/p/${projectId}/tasks`, { method: "POST", json: { taskId, goal } });
      if (useAgent) {
        await apiJson(`/p/${projectId}/tasks/${taskId}/agent`, { method: "POST" });
        setNotice("An AI agent is working on it in its own isolated workspace. It will mark the change ready when it's done.");
      } else {
        setInstructions({ commands: created.commands, task: taskId });
      }
      setGoal("");
    });

  const act = (task: Task, action: "ready" | "cancel" | "agent") =>
    run(`${action}-${task.id}`, async () => {
      await apiJson(`/p/${projectId}/tasks/${task.id}/${action}`, { method: "POST" });
      if (action === "agent") setNotice("An AI agent is working on this change.");
    });

  const integrate = () =>
    run("integrate", async () => {
      await apiJson(`/p/${projectId}/integrations`, { method: "POST", json: { taskIds: selected } });
      setSelected([]);
      setNotice("Combining the selected changes, repairing conflicts and verifying. Watch progress in the Integration tab.");
    });

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 2 ? [cur[1]!, id] : [...cur, id]));

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="text-sm font-semibold">Start a change</div>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder="Describe what should change, e.g. “Add input validation to the signup form”"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={useAgent} onChange={(e) => setUseAgent(e.target.checked)} />
              <Bot className="h-4 w-4" /> Let an AI agent do the work
            </label>
            <Button variant="orange" disabled={!goal.trim() || busy !== null} onClick={create}>
              <Plus className="h-4 w-4 mr-1.5" /> {busy === "create" ? "Creating…" : useAgent ? "Start with an agent" : "Create and get git commands"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Each change gets its own isolated copy of the repository. Anyone can also push with plain Git; nothing is merged until it passes your checks.</p>
        </CardContent>
      </Card>

      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">{notice}</div>}

      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Changes ({tasks.length})</div>
        <Button variant="outline" size="sm" disabled={selected.length !== 2 || busy !== null} onClick={integrate}>
          <GitPullRequestArrow className="h-4 w-4 mr-1.5" /> Integrate selected ({selected.length}/2)
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {tasks.length === 0 && <p className="p-4 text-sm text-muted-foreground">No changes yet. Start one above.</p>}
          {tasks.map((t) => {
            const st = STATUS[t.status];
            const canSelect = t.status === "ready" || t.status === "blocked";
            return (
              <div key={t.id} className="px-4 py-3 flex items-start gap-3">
                <input type="checkbox" className="mt-1.5" disabled={!canSelect} checked={selected.includes(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.id}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{t.goal}</span>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t.contributor.type === "agent" ? "AI agent" : t.contributor.name} · {t.id} · {timeAgo(t.createdAt)}
                    {t.blockedReason ? ` · ${t.blockedReason}` : ""}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {t.checkpoints.length > 0 && t.status !== "accepted" && t.status !== "cancelled" && (
                    <Button size="sm" variant="outline" onClick={() => navigate(`/p/${projectId}/review?task=${t.id}`)}>Review</Button>
                  )}
                  {(t.status === "working" || t.status === "checkpointed") && (
                    <>
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act(t, "ready")}><Check className="h-3.5 w-3.5 mr-1" />Ready</Button>
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(t, "agent")}><Bot className="h-3.5 w-3.5 mr-1" />Agent</Button>
                    </>
                  )}
                  {t.status !== "accepted" && t.status !== "cancelled" && t.status !== "integrating" && t.status !== "verifying" && (
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(t, "cancel")} aria-label={`Cancel ${t.id}`}><X className="h-3.5 w-3.5" /></Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={instructions !== null} onOpenChange={() => setInstructions(null)}>
        <DialogHeader>
          <DialogTitle>Work on it with Git</DialogTitle>
          <DialogDescription>Your credential works only for this change and expires in one hour. Push your commits, then press “Ready”.</DialogDescription>
        </DialogHeader>
        <pre className="text-xs bg-muted/40 rounded-md p-3 overflow-auto whitespace-pre-wrap break-all">{instructions?.commands.join("\n")}</pre>
        <div className="flex justify-end gap-2 mt-3">
          <Button
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(instructions?.commands.join("\n") ?? "");
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Copy className="h-4 w-4 mr-1.5" /> {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="orange" onClick={() => setInstructions(null)}>Done</Button>
        </div>
      </Dialog>
    </div>
  );
}
