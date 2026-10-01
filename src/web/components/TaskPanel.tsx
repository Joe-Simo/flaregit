import React from "react";
import { Users, Bot, User, GitBranch, GitCommit, CheckSquare, Clock, ArrowRight, ShieldCheck, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Task, TaskStatus } from "@/core/types";

interface TaskPanelProps {
  tasks: Record<string, Task>;
  onSelectTask?: (taskId: string) => void;
  selectedTaskId?: string;
}

export function TaskPanel({ tasks, onSelectTask, selectedTaskId }: TaskPanelProps) {
  const taskList = Object.values(tasks);

  const getStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case "working":
        return <Badge variant="secondary">Working</Badge>;
      case "ready":
        return <Badge variant="info">Ready to Integrate</Badge>;
      case "integrating":
        return <Badge variant="warning">Integrating...</Badge>;
      case "verifying":
        return <Badge variant="warning">Verifying...</Badge>;
      case "accepted":
        return <Badge variant="success">✓ Accepted</Badge>;
      case "needs_decision":
        return <Badge variant="purple">Needs Decision</Badge>;
      case "blocked":
        return <Badge variant="destructive">Blocked</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Card className="h-full flex flex-col border-border/80 bg-card/70 backdrop-blur-sm">
      <CardHeader className="pb-3 border-b border-border/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Concurrent Contributors
            </CardTitle>
          </div>
          <span className="text-xs text-muted-foreground">
            {taskList.length} Active Workspaces
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-3 flex-1 overflow-y-auto space-y-3">
        {taskList.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-xs">
            <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>No parallel workspaces active.</p>
            <p className="mt-1">Launch Act I, II, or III to observe autonomous integration.</p>
          </div>
        ) : (
          taskList.map((task) => {
            const isSelected = selectedTaskId === task.id;
            const isAgent = task.contributor.type === "agent";

            return (
              <div
                key={task.id}
                onClick={() => onSelectTask?.(task.id)}
                className={`p-3.5 rounded-lg border transition-all cursor-pointer ${
                  isSelected
                    ? "border-primary bg-primary/5 shadow-md shadow-primary/5"
                    : "border-border/60 bg-muted/30 hover:border-border hover:bg-muted/50"
                }`}
              >
                {/* Header: Contributor & Status */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        isAgent
                          ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                          : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                      }`}
                    >
                      {isAgent ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                    </div>
                    <div>
                      <div className="text-xs font-semibold leading-tight text-foreground flex items-center gap-1.5">
                        <span>{task.contributor.name}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">({task.id})</span>
                      </div>
                    </div>
                  </div>
                  {getStatusBadge(task.status)}
                </div>

                {/* Task Goal */}
                <div className="text-xs font-medium text-foreground/90 mb-2.5 bg-background/50 p-2 rounded border border-border/40">
                  <span className="text-muted-foreground font-normal">Goal: </span>
                  {task.goal}
                </div>

                {/* Behavioral Requirements */}
                {task.requirements.length > 0 && (
                  <div className="mb-2.5 space-y-1">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      <CheckSquare className="h-3 w-3 text-emerald-400" />
                      <span>Requirements ({task.requirements.length}):</span>
                    </div>
                    {task.requirements.map((req) => (
                      <div
                        key={req.id}
                        className={`text-[11px] px-2 py-1 rounded flex items-center justify-between ${
                          req.status === "approved"
                            ? "bg-emerald-950/20 text-emerald-300 border border-emerald-500/20"
                            : req.status === "superseded"
                            ? "bg-muted/50 text-muted-foreground line-through border border-border/40"
                            : "bg-purple-950/20 text-purple-300 border border-purple-500/20"
                        }`}
                      >
                        <span className="truncate">{req.title}</span>
                        <span className="text-[10px] font-mono shrink-0 ml-1">v{req.version}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Workspace Details */}
                <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                  <div className="flex items-center gap-1">
                    <GitBranch className="h-3 w-3 text-primary" />
                    <span>{task.workspace.branch}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <GitCommit className="h-3 w-3" />
                    <span>{task.currentCommit.slice(0, 7)}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
