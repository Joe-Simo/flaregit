import type {
  FlareGitProjectState,
  Task,
  CandidateGeneration,
  VerificationEvidence,
  ProductDecision,
  PublicationJournalEntry,
} from "../core/types.js";

/**
 * Cloudflare Durable Object: RepositoryController
 * 
 * Provides single-point-of-truth coordination, SQLite-backed transactional
 * state, CAS ref locks, and WebSocket/SSE broadcast for FlareGit.
 */
export class RepositoryController {
  private state: DurableObjectState;
  private env: any;
  private projectState: FlareGitProjectState | null = null;
  private sessions: Set<WebSocket> = new Set();

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
    this.initSqlite();
  }

  private initSqlite(): void {
    const sql = (this.state.storage as any).sql;
    if (!sql) return;

    sql.exec(`
      CREATE TABLE IF NOT EXISTS project_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        current_commit TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        candidate_commit TEXT,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        selected_option TEXT,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS publication_journal (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        candidate_commit TEXT NOT NULL,
        state TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket connect for live updates
    if (url.pathname === "/ws" || request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();
      this.sessions.add(server as any);

      server.addEventListener("close", () => {
        this.sessions.delete(server as any);
      });

      return new Response(null, { status: 101, webSocket: client } as any);
    }

    // REST API routes
    if (url.pathname === "/api/state" && request.method === "GET") {
      const state = await this.getFullState();
      return Response.json(state);
    }

    if (url.pathname === "/api/tasks" && request.method === "POST") {
      const body = await request.json() as any;
      const task = await this.createTask(body);
      return Response.json(task);
    }

    if (url.pathname.startsWith("/api/tasks/") && url.pathname.endsWith("/checkpoint") && request.method === "POST") {
      const taskId = url.pathname.split("/")[3]!;
      const body = await request.json() as any;
      const result = await this.recordCheckpoint(taskId, body);
      return Response.json(result);
    }

    if (url.pathname === "/api/decisions/resolve" && request.method === "POST") {
      const body = await request.json() as any;
      const result = await this.resolveDecision(body.decisionId, body.selectedOptionId);
      return Response.json(result);
    }

    return new Response("Not found", { status: 404 });
  }

  private broadcast(event: { type: string; payload: unknown }): void {
    const msg = JSON.stringify(event);
    for (const ws of this.sessions) {
      try {
        ws.send(msg);
      } catch {
        this.sessions.delete(ws);
      }
    }
  }

  async getFullState(): Promise<FlareGitProjectState> {
    if (this.projectState) return this.projectState;

    const stored = await this.state.storage.get<FlareGitProjectState>("project_state");
    if (stored) {
      this.projectState = stored;
      return stored;
    }

    // Default initialization
    const initial: FlareGitProjectState = {
      projectId: "flaregit-primary",
      projectName: "FlareGit Production Platform",
      canonicalRepoName: "flaregit-canonical",
      acceptedState: {
        currentCommit: "a876cf4",
        acceptedAt: new Date().toISOString(),
        buildDigest: "sha256:init",
        activeRequirements: [],
        history: [],
      },
      tasks: {},
      candidates: {},
      evidence: {},
      decisions: {},
      journal: [],
      policyVersion: 1,
    };

    await this.state.storage.put("project_state", initial);
    this.projectState = initial;
    return initial;
  }

  async setFullState(newState: FlareGitProjectState): Promise<void> {
    this.projectState = newState;
    await this.state.storage.put("project_state", newState);
    this.broadcast({ type: "state.updated", payload: newState });
  }

  async createTask(opts: {
    taskId: string;
    goal: string;
    contributorName: string;
    contributorType: "human" | "agent";
  }): Promise<Task> {
    const state = await this.getFullState();
    const task: Task = {
      id: opts.taskId,
      goal: opts.goal,
      contributor: {
        id: `contrib-${opts.taskId}`,
        name: opts.contributorName,
        type: opts.contributorType,
      },
      baseCommit: state.acceptedState.currentCommit,
      allowedScope: ["src/pricing.ts", "src/catalog.ts"],
      status: "working",
      requirements: [],
      workspace: {
        repoName: `task-${opts.taskId}`,
        remote: `artifacts://flaregit-default/task-${opts.taskId}`,
        branch: `task/${opts.taskId}`,
      },
      checkpoints: [],
      currentCommit: state.acceptedState.currentCommit,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    state.tasks[task.id] = task;
    await this.setFullState(state);
    this.broadcast({ type: "task.created", payload: task });
    return task;
  }

  async recordCheckpoint(taskId: string, opts: { message?: string; isReadyForIntegration?: boolean }): Promise<Task> {
    const state = await this.getFullState();
    const task = state.tasks[taskId];
    if (!task) throw new Error(`Task ${taskId} not found`);

    task.status = opts.isReadyForIntegration ? "ready" : "working";
    task.updatedAt = new Date().toISOString();
    await this.setFullState(state);
    this.broadcast({ type: "task.checkpointed", payload: { task } });
    return task;
  }

  async resolveDecision(decisionId: string, selectedOptionId: string): Promise<ProductDecision> {
    const state = await this.getFullState();
    const decision = state.decisions[decisionId];
    if (!decision) throw new Error(`Decision ${decisionId} not found`);

    decision.selectedOptionId = selectedOptionId;
    decision.status = "resolved";
    decision.resolvedAt = new Date().toISOString();

    await this.setFullState(state);
    this.broadcast({ type: "decision.resolved", payload: { decision, selectedOptionId } });
    return decision;
  }
}
