import React, { useEffect, useState } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { apiJson } from "../api";
import type { FlareGitProjectState } from "@/core/types";

/** Repositories inspected for agent work; bounded so the dashboard stays fast. */
const INSPECTED_REPOSITORIES = 5;

interface ChecklistRepository { id: string; name: string; role: "owner" | "member" }
interface AgentProgress { agentRepositoryId: string | null; reviewed: boolean }

function agentProgress(states: { id: string; state: FlareGitProjectState }[]): AgentProgress {
  let agentRepositoryId: string | null = null;
  let reviewed = false;
  for (const { id, state } of states) {
    const agentTaskIds = new Set(Object.values(state.tasks).filter(task => task.contributor.type === "agent").map(task => task.id));
    if (agentTaskIds.size === 0) continue;
    agentRepositoryId ??= id;
    const merged = Object.values(state.tasks).some(task => agentTaskIds.has(task.id) && task.status === "accepted");
    const reviewedPreview = Object.values(state.candidates).some(preview => preview.review !== undefined && preview.participatingTaskIds.some(taskId => agentTaskIds.has(taskId)));
    if (merged || reviewedPreview) { reviewed = true; agentRepositoryId = id; break; }
  }
  return { agentRepositoryId, reviewed };
}

/**
 * Get started: create or import a repository, start an agent, review its first change.
 * Every tick is derived from the signed-in account's real repositories and their recorded state.
 */
export function GetStartedChecklist({ repositories }: { repositories: ChecklistRepository[] }) {
  const [progress, setProgress] = useState<AgentProgress | null>(null);
  const [failed, setFailed] = useState(false);
  const inspected = repositories.slice(0, INSPECTED_REPOSITORIES);
  const key = inspected.map(repo => repo.id).join(",");
  useEffect(() => {
    if (!key) { setProgress({ agentRepositoryId: null, reviewed: false }); return; }
    const controller = new AbortController();
    setFailed(false);
    const ids = key.split(",");
    void Promise.allSettled(ids.map(id => apiJson<FlareGitProjectState>(`/p/${encodeURIComponent(id)}/state`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }).then(state => ({ id, state }))))
      .then(results => {
        if (controller.signal.aborted) return;
        const loaded = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
        if (loaded.length === 0) { setFailed(true); return; }
        setProgress(agentProgress(loaded));
      });
    return () => controller.abort();
  }, [key]);

  const firstRepository = repositories.find(repo => repo.role === "owner") ?? repositories[0];
  const steps = [
    { id: "repository", title: "Create or import a repository", detail: "Start empty or bring existing Git history.", done: repositories.length > 0, href: "/new", cta: "New repository" },
    { id: "agent", title: "Start an agent on a task", detail: "Describe the work; the agent pushes to its own isolated copy.", done: progress?.agentRepositoryId != null, href: firstRepository ? `/p/${firstRepository.id}/changes` : null, cta: "Start with an agent" },
    { id: "review", title: "Review its first change", detail: "Read the diff and checks, then merge or send it back.", done: progress?.reviewed === true, href: progress?.agentRepositoryId ? `/p/${progress.agentRepositoryId}/review` : null, cta: "Open review" },
  ];
  if (progress && steps.every(step => step.done)) return null;
  const nextIndex = steps.findIndex(step => !step.done);
  const completed = steps.filter(step => step.done).length;
  return (
    <section aria-labelledby="home-get-started" className="mb-8">
      <div className="home-section-heading flex items-baseline justify-between gap-3">
        <h2 id="home-get-started">Get started</h2>
        <span className="text-xs text-muted-foreground" aria-live="polite">{progress ? `${completed} of ${steps.length} done` : "Checking your progress…"}</span>
      </div>
      {failed && <p role="alert" className="mb-2 text-xs text-destructive">Agent progress could not be checked. Repository steps remain accurate.</p>}
      <Card className="divide-y divide-border">
        <ol>
          {steps.map((step, index) => {
            const next = index === nextIndex && progress !== null;
            return (
              <li key={step.id} className="flex items-start gap-3 px-4 py-3">
                <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${step.done ? "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500" : next ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
                  {step.done ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${step.done ? "text-muted-foreground line-through decoration-muted-foreground/50" : ""}`}>
                    {step.title}<span className="sr-only">{step.done ? " (done)" : " (not done)"}</span>
                  </p>
                  {!step.done && <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>}
                </div>
                {next && step.href && (
                  <a
                    href={`#${step.href}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {step.cta}<ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      </Card>
    </section>
  );
}
