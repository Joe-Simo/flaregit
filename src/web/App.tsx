import { apiFetch } from "./api";
import React, { useState, useEffect } from "react";
import { Header } from "./components/Header";
import { BillingBar } from "./components/BillingBar";
import { StatusBanner, type PipelineStage } from "./components/StatusBanner";
import { TaskPanel } from "./components/TaskPanel";
import { CandidateJournal } from "./components/CandidateJournal";
import { LivePreview } from "./components/LivePreview";
import { DecisionModal } from "./components/DecisionModal";
import { EvidenceDrawer } from "./components/EvidenceDrawer";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { FlareGitProjectState, ProductDecision } from "@/core/types";

export function App() {
  const [state, setState] = useState<FlareGitProjectState | null>(null);
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("All systems operational");
  const [statusDetail, setStatusDetail] = useState<string | undefined>(
    "Parallel contributors can checkpoint and push changes freely."
  );
  const [activeDecision, setActiveDecision] = useState<ProductDecision | null>(null);
  const [isEvidenceOpen, setIsEvidenceOpen] = useState<boolean>(false);
  const [isRunningScenario, setIsRunningScenario] = useState<boolean>(false);
  const [activeAct, setActiveAct] = useState<string | null>(null);
  const [isResolvingDecision, setIsResolvingDecision] = useState<boolean>(false);
  const [leftTab, setLeftTab] = useState<string>("tasks");
  const [previewBase, setPreviewBase] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const refreshRef = React.useRef<() => void>(() => undefined);

  // Fetch initial state
  useEffect(() => {
    const load = () =>
      apiFetch("/api/state")
        .then(async (res) => {
          if (res.status === 404) {
            // First visit: create this customer's isolated workspace (repo + ledger).
            setStatusMessage("Setting up your workspace");
            setStatusDetail("Creating your private repository…");
            const created = await apiFetch("/api/projects/bootstrap", { method: "POST" });
            if (!created.ok) throw new Error(`Workspace setup failed (${created.status})`);
            res = await apiFetch("/api/state");
          }
          if (!res.ok) throw new Error(`Backend responded ${res.status}`);
          return res.json() as Promise<FlareGitProjectState>;
        })
        .then((data) => {
          setState(data);
          setLoadError(null);
          setStatusMessage("All systems operational");
          setStatusDetail("Parallel contributors can checkpoint and push changes freely.");
          const pending = Object.values(data.decisions || {}).find((d) => d.status === "pending");
          if (pending) {
            setActiveDecision(pending);
            setPipelineStage("decision_needed");
            setStatusMessage("Product decision required");
            setStatusDetail("The last accepted version stays live until you choose.");
          }
        })
        .catch((err: Error) => setLoadError(err.message));
    load();
    refreshRef.current = load;
    apiFetch("/api/config").then((r) => r.json() as Promise<{ previewBase: string }>).then((c) => setPreviewBase(c.previewBase)).catch(() => undefined);

    // Connect to Server-Sent Events (SSE)
    const eventSource = new EventSource("/api/events");

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        handleServerEvent(parsed);
      } catch (e) {
        console.error("Error parsing SSE event:", e);
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const handleServerEvent = (event: { type: string; payload: any }) => {
    switch (event.type) {
      case "candidate.frozen":
        setPipelineStage("analyzing");
        setStatusMessage("Combining contributors' work");
        setStatusDetail("Composing the candidate on top of the accepted version.");
        break;
      case "candidate.repairing":
        setPipelineStage("repairing");
        setStatusMessage(`Repairing (round ${event.payload?.round ?? 1})`);
        setStatusDetail("Workers AI proposes a fix; it is only accepted if protected verification passes.");
        break;
      case "candidate.verifying":
        setPipelineStage("verifying");
        setStatusMessage("Verifying the exact candidate");
        setStatusDetail("Protected checks run against the candidate commit in an isolated workspace.");
        break;
      case "candidate.verified":
        setStatusMessage("Verification passed");
        setStatusDetail("Publishing the exact verified commit.");
        break;
      case "candidate.accepted":
        setPipelineStage("accepted");
        setStatusMessage("Accepted");
        setStatusDetail(`Canonical head is now ${String(event.payload?.record?.commit ?? "").slice(0, 7)}.`);
        break;
      case "candidate.failed":
        setPipelineStage("blocked");
        setStatusMessage("Blocked");
        setStatusDetail(`${event.payload?.failureBlocker ?? "Integration failed"} — the last accepted version is unchanged.`);
        break;
      case "candidate.stale":
        setStatusMessage("Accepted version moved; recomposing");
        break;
      case "decision.needed":
        setActiveDecision(event.payload);
        setPipelineStage("decision_needed");
        setStatusMessage("Product decision required");
        setStatusDetail("The last accepted version stays live until you choose.");
        break;
      case "decision.resolved":
        setActiveDecision(null);
        break;
    }
    refreshRef.current();
  };

  const handleRunScenario = async (act: "act1" | "act2" | "act3") => {
    setIsRunningScenario(true);
    setActiveAct(act);
    setScenarioError(null);
    setPipelineStage("working");
    setStatusMessage("Contributors are working");
    setStatusDetail("Two agents implement their tasks in isolated workspaces.");
    try {
      const res = await apiFetch("/api/scenarios/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ act }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      setScenarioError(err instanceof Error ? err.message : "Scenario failed");
      setPipelineStage("blocked");
      setStatusMessage("Scenario could not run");
    } finally {
      setIsRunningScenario(false);
      setActiveAct(null);
      refreshRef.current();
    }
  };

  const handleResolveDecision = async (decisionId: string, selectedOptionId: string) => {
    setIsResolvingDecision(true);
    try {
      const res = await apiFetch("/api/decisions/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisionId, selectedOptionId }),
      });
      if (!res.ok) throw new Error(await res.text());
      setActiveDecision(null);
    } catch (err) {
      setScenarioError(err instanceof Error ? err.message : "Could not apply decision");
    } finally {
      setIsResolvingDecision(false);
      refreshRef.current();
    }
  };

  const currentCommit = state?.acceptedState?.currentCommit ?? "";
  const activeRequirements = state?.acceptedState?.activeRequirements || [];
  const evidenceList = Object.values(state?.evidence || {});
  const journal = state?.journal || [];
  const tasks = state?.tasks || {};
  const candidates = state?.candidates || {};

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground font-sans">
      {/* 1. Header */}
      <Header
        currentCommit={currentCommit}
        onRunScenario={handleRunScenario}
        onOpenEvidence={() => setIsEvidenceOpen(true)}
        isRunningScenario={isRunningScenario}
        activeAct={activeAct}
      />

      <BillingBar refreshKey={Object.keys(tasks).length} />

      {/* 2. Real-time Status Banner */}
      <StatusBanner
        stage={pipelineStage}
        message={statusMessage}
        detail={statusDetail}
        lastAcceptedCommit={currentCommit}
      />

      {(loadError || scenarioError) && (
        <div role="alert" className="mx-6 mt-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {loadError ? `Cannot reach the FlareGit backend: ${loadError}` : scenarioError}
        </div>
      )}

      {/* 3. Main Two-Column Layout */}
      <main className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-[1700px] w-full mx-auto">
        {/* Left Column: Tasks & Candidates/Journal (5 cols) */}
        <div className="lg:col-span-5 flex flex-col h-[calc(100vh-160px)] min-h-[600px]">
          <Tabs value={leftTab} onValueChange={setLeftTab} className="flex-1 flex flex-col">
            <TabsList className="w-full grid grid-cols-2 mb-3">
              <TabsTrigger value="tasks">Parallel Workspaces</TabsTrigger>
              <TabsTrigger value="journal">Candidates & CAS</TabsTrigger>
            </TabsList>

            <TabsContent value="tasks" className="flex-1 overflow-hidden mt-0">
              <TaskPanel tasks={tasks} />
            </TabsContent>

            <TabsContent value="journal" className="flex-1 overflow-hidden mt-0">
              <CandidateJournal candidates={candidates} journal={journal} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Column: Live Application Preview (7 cols) */}
        <div className="lg:col-span-7 h-[calc(100vh-160px)] min-h-[600px]">
          {currentCommit && previewBase ? <LivePreview currentCommit={currentCommit} previewBase={previewBase} /> : null}
        </div>
      </main>

      <footer className="px-6 py-3 text-xs text-muted-foreground flex gap-4 border-t border-border">
        <a href="/terms" className="hover:underline">Terms</a>
        <a href="/privacy" className="hover:underline">Privacy</a>
        <a href="mailto:support@flaregit.com" className="hover:underline">Support</a>
      </footer>

      {/* 4. Product Decision Modal */}
      <DecisionModal
        decision={activeDecision}
        onResolve={handleResolveDecision}
        onDismiss={() => setActiveDecision(null)}
        isResolving={isResolvingDecision}
      />

      {/* 5. Evidence Audit Drawer */}
      <EvidenceDrawer
        open={isEvidenceOpen}
        onOpenChange={setIsEvidenceOpen}
        activeRequirements={activeRequirements}
        evidenceList={evidenceList}
        journal={journal}
        candidates={candidates}
      />
    </div>
  );
}
