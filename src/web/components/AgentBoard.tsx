import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, GitCommitHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  AGENT_BOARD_ACCESS_CLOSED, agentBoardEventSchema, agentBoardTicketSchema,
  type AgentBoardAgent, type AgentBoardClientMessage, type AgentBoardEvent, type OverlapWarning,
} from "@/core/agent-board";
import { apiJson } from "../api";

/** Navigation entry for the live board; placed by the repository navigation. */
export const AGENTS_ENTRY = { key: "agents", label: "Agents", description: "Live board of every running agent: progress, files touched and overlap warnings between concurrent agents." } as const;

type Connection = "connecting" | "live" | "reconnecting" | "access-withdrawn";
interface BoardState { seq: number; agents: ReadonlyMap<string, AgentBoardAgent>; overlaps: ReadonlyMap<string, OverlapWarning> }

const PHASE_LABEL: Record<AgentBoardAgent["phase"], string> = { planning: "Planning", proposed: "Proposal saved", pushed: "Pushed", checkpointed: "Checkpointed" };
const CONNECTION_LABEL: Record<Connection, string> = { connecting: "Connecting to live board…", live: "Live", reconnecting: "Connection lost; reconnecting…", "access-withdrawn": "Your repository access changed; live updates stopped." };
const KIND_LABEL: Record<OverlapWarning["kind"], string> = { same_file: "both editing", divergent_content: "conflicting edits likely", identical_content: "identical edits" };
const MAX_BACKOFF_MS = 30_000;

/** Applies one event; returns null when a sequence gap requires a fresh snapshot. */
function apply(state: BoardState | null, event: AgentBoardEvent): BoardState | null | "ignore" {
  if (event.type === "snapshot") return { seq: event.seq, agents: new Map(event.agents.map(agent => [agent.runId, agent])), overlaps: new Map(event.overlaps.map(overlap => [overlap.id, overlap])) };
  if (!state || event.seq <= state.seq) return "ignore";
  if (event.seq !== state.seq + 1) return null;
  const agents = new Map(state.agents), overlaps = new Map(state.overlaps);
  if (event.type === "agent.updated") agents.set(event.agent.runId, event.agent);
  else if (event.type === "agent.removed") agents.delete(event.runId);
  else if (event.type === "overlap.added") overlaps.set(event.overlap.id, event.overlap);
  else overlaps.delete(event.id);
  return { seq: event.seq, agents, overlaps };
}

function useAgentBoard(projectId: string) {
  const [board, setBoard] = useState<BoardState | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  useEffect(() => {
    let stopped = false, socket: WebSocket | null = null, timer: ReturnType<typeof setTimeout> | undefined, attempt = 0, current: BoardState | null = null;
    const schedule = () => {
      if (stopped) return;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt) * (0.5 + Math.random() / 2);
      attempt++;
      setConnection("reconnecting");
      timer = setTimeout(() => void connect(), delay);
    };
    const send = (message: AgentBoardClientMessage) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
    const connect = async () => {
      let ticket: string;
      try { ticket = agentBoardTicketSchema.parse(await apiJson<unknown>(`/p/${projectId}/agents/board/ticket`, { method: "POST" })).ticket; }
      catch { schedule(); return; }
      if (stopped) return;
      const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${scheme}//${window.location.host}/api/p/${projectId}/agents/board/socket?ticket=${ticket}`);
      socket = ws;
      ws.onmessage = (message) => {
        if (typeof message.data !== "string") return;
        let raw: unknown;
        try { raw = JSON.parse(message.data); } catch { return; }
        const parsed = agentBoardEventSchema.safeParse(raw);
        if (!parsed.success) return;
        const next = apply(current, parsed.data);
        if (next === "ignore") return;
        if (next === null) { send({ type: "resync" }); return; }
        if (parsed.data.type === "snapshot") { attempt = 0; setConnection("live"); }
        current = next; setBoard(next);
      };
      ws.onclose = (event) => {
        if (socket !== ws || stopped) return;
        socket = null;
        if (event.code === AGENT_BOARD_ACCESS_CLOSED) setConnection("access-withdrawn");
        // A withdrawn viewer retries too: the ticket request is refused until access returns.
        schedule();
      };
    };
    void connect();
    return () => { stopped = true; clearTimeout(timer); socket?.close(1000, "Board closed"); };
  }, [projectId]);
  return { board, connection };
}

function AgentRow({ agent, overlaps }: { agent: AgentBoardAgent; overlaps: OverlapWarning[] }) {
  const status = `${PHASE_LABEL[agent.phase]}, step ${agent.progress.step} of ${agent.progress.steps}, round ${agent.progress.round}`;
  return (
    <li className="rounded-md border border-border p-3 space-y-2" aria-label={`Agent for change ${agent.taskId}`}>
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <Bot className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium truncate min-w-0">{agent.title}</span>
        <Badge variant="outline">{agent.taskId}</Badge>
        <Badge variant={overlaps.length ? "warning" : "secondary"}>{PHASE_LABEL[agent.phase]}</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{status}</span>
        <progress className="h-1.5 w-28 accent-primary" max={agent.progress.steps} value={agent.progress.step} aria-label={`Progress for change ${agent.taskId}`} />
        <span className="inline-flex items-center gap-1"><GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden="true" /><code>{agent.commit ? agent.commit.slice(0, 12) : "no commit yet"}</code></span>
        <span>change status: {agent.taskStatus}</span>
      </div>
      {agent.filesTouched.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer">{agent.filesTouched.length} file{agent.filesTouched.length === 1 ? "" : "s"} touched</summary>
          <ul className="mt-1 font-mono break-all">{agent.filesTouched.map(file => <li key={file}>{file}</li>)}</ul>
        </details>
      )}
      {overlaps.length > 0 && (
        <ul className="space-y-1" aria-label={`Overlap warnings for change ${agent.taskId}`}>
          {overlaps.map(overlap => {
            const other = overlap.a.runId === agent.runId ? overlap.b : overlap.a;
            return <li key={overlap.id} className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span>Overlap ({KIND_LABEL[overlap.kind]}): change {other.taskId} “{other.title}” also edits <code className="break-all">{overlap.path}</code></span>
            </li>;
          })}
        </ul>
      )}
    </li>
  );
}

/** Live board: one row per in-flight agent run, updated over a hibernatable WebSocket. */
export function AgentBoard({ projectId }: { projectId: string }) {
  const { board, connection } = useAgentBoard(projectId);
  const agents = useMemo(() => [...(board?.agents.values() ?? [])].sort((a, b) => a.taskId.localeCompare(b.taskId)), [board]);
  const overlapCount = board?.overlaps.size ?? 0;
  return (
    <section aria-labelledby="agent-board-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="agent-board-heading" className="text-base font-semibold">Agents</h2>
        <p role="status" aria-live="polite" className={`text-xs ${connection === "live" ? "text-muted-foreground" : "text-amber-800 dark:text-amber-200"}`}>
          {CONNECTION_LABEL[connection]}{board ? ` · ${agents.length} active agent${agents.length === 1 ? "" : "s"}, ${overlapCount} overlap warning${overlapCount === 1 ? "" : "s"}` : ""}
        </p>
      </div>
      {board === null ? <p className="text-sm text-muted-foreground">Waiting for the first board snapshot…</p>
        : agents.length === 0 ? <p className="text-sm text-muted-foreground">No agents are working on this repository right now.</p>
        : <ul className="space-y-2">{agents.map(agent => <AgentRow key={agent.runId} agent={agent} overlaps={agent.overlapIds.flatMap(id => board.overlaps.get(id) ?? [])} />)}</ul>}
    </section>
  );
}
