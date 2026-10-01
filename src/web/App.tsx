import React, { useState, useEffect } from "react";
import { Header } from "./components/Header";
import { StatusBanner, type PipelineStage } from "./components/StatusBanner";
import { TaskPanel } from "./components/TaskPanel";
import { CandidateJournal } from "./components/CandidateJournal";
import { LivePreview } from "./components/LivePreview";
import { DecisionModal } from "./components/DecisionModal";
import { EvidenceDrawer } from "./components/EvidenceDrawer";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { FlareGitProjectState, ProductDecision, Requirement } from "@/core/types";

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

  // Current policy defaults
  const [policy, setPolicy] = useState({
    groupDiscountPercent: 0.15,
    minTicketsForDiscount: 4,
    refundFeePerTicket: 5.0,
    discountAppliesToRefundFee: false,
  });

  // Fetch initial state
  useEffect(() => {
    fetch("/api/state")
      .then((res) => res.json() as Promise<FlareGitProjectState>)
      .then((data) => {
        setState(data);
        // Check for pending decision
        const pending = Object.values(data.decisions || {}).find((d) => d.status === "pending");
        if (pending) {
          setActiveDecision(pending);
          setPipelineStage("decision_needed");
          setStatusMessage("Product Decision Required");
          setStatusDetail("Contradictory business rules detected between parallel contributors.");
        }
      })
      .catch((err) => {
        console.warn("Could not connect to live backend, running with initial local state:", err);
        // Provide rich mock state if running purely in static browser
        setState({
          projectId: "flaregit-primary",
          projectName: "FlareGit Platform",
          canonicalRepoName: "flaregit-canonical",
          acceptedState: {
            currentCommit: "b84a5f8",
            acceptedAt: new Date().toISOString(),
            buildDigest: "sha256:verified_init",
            activeRequirements: [
              {
                id: "REQ-BASE-SINGLE-TICKET",
                title: "Baseline Ticket Checkout",
                description: "1 ticket @ $40 without extras equals exactly $40.00",
                version: 1,
                status: "approved",
                originTaskId: "task-seed",
                approvedAt: new Date().toISOString(),
                assertions: [],
              },
            ],
            history: [],
          },
          tasks: {},
          candidates: {},
          evidence: {},
          decisions: {},
          journal: [],
          policyVersion: 1,
        });
      });

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
        setStatusMessage("Analyzing compatibility & freezing generation...");
        setStatusDetail("Generating candidate inputs across parallel task workspaces.");
        break;

      case "candidate.repairing":
        setPipelineStage("repairing");
        setStatusMessage("Autonomous Bounded Repair in Progress...");
        setStatusDetail(
          `Invoking Cloudflare Workers AI for Round ${event.payload?.round || 1} synthesis.`
        );
        break;

      case "candidate.verifying":
        setPipelineStage("verifying");
        setStatusMessage("Running Independent Protected Verification...");
        setStatusDetail("Executing test suite against candidate commit in isolated sandbox.");
        break;

      case "candidate.verified":
        setStatusMessage("Verification Passed! Preparing CAS publication...");
        setStatusDetail("Candidate satisfies all behavioral contracts.");
        break;

      case "candidate.accepted":
        setPipelineStage("accepted");
        setStatusMessage("Exact Version Accepted & Published!");
        setStatusDetail(
          `Canonical HEAD advanced to commit ${event.payload?.record?.commit?.slice(0, 7)}.`
        );
        if (state) {
          setState({
            ...state,
            acceptedState: event.payload.acceptedState,
          });
        }
        break;

      case "decision.needed":
        setActiveDecision(event.payload);
        setPipelineStage("decision_needed");
        setStatusMessage("Contradictory Requirements Detected");
        setStatusDetail("Zero downtime: preserved last accepted version while waiting for decision.");
        break;

      case "decision.resolved":
        setActiveDecision(null);
        setPipelineStage("accepted");
        setStatusMessage("Decision Applied & Integrated!");
        setStatusDetail("Approved policy synthesized and verified.");
        if (event.payload?.discountAppliesToRefundFee !== undefined) {
          setPolicy((prev) => ({
            ...prev,
            discountAppliesToRefundFee: event.payload.discountAppliesToRefundFee,
          }));
        }
        break;

      case "state.updated":
        setState(event.payload);
        break;
    }
  };

  const handleRunScenario = async (act: "act1" | "act2" | "act3") => {
    setIsRunningScenario(true);
    setActiveAct(act);

    if (act === "act1") {
      setPipelineStage("composing");
      setStatusMessage("Running Act I: Concurrent agents with textual conflict...");
      setStatusDetail("Agent A (15% discount) and Agent B ($5 refund surcharge) editing src/pricing.ts.");
    } else if (act === "act2") {
      setPipelineStage("verifying");
      setStatusMessage("Running Act II: Clean merge with semantic units mismatch...");
      setStatusDetail("Clean Git merge produced broken behavior; catching via protected verifier.");
    } else if (act === "act3") {
      setPipelineStage("analyzing");
      setStatusMessage("Running Act III: Incompatible requirements...");
      setStatusDetail("Detecting contradictory business rules and pausing safely for product decision.");
    }

    try {
      const res = await fetch("/api/scenarios/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ act }),
      });
      const data = await res.json() as any;

      // Refresh state
      const stateRes = await fetch("/api/state");
      const newState = await stateRes.json() as FlareGitProjectState;
      setState(newState);

      // Check for decision
      const pending = Object.values(newState.decisions || {}).find((d) => d.status === "pending");
      if (pending) {
        setActiveDecision(pending);
        setPipelineStage("decision_needed");
        setStatusMessage("Product Decision Required");
        setStatusDetail("Contradictory requirements detected between parallel contributors.");
      } else {
        setPipelineStage("accepted");
        setStatusMessage(`Scenario ${act.toUpperCase()} Completed Successfully!`);
        setStatusDetail(`All behavioral contracts satisfied and verified.`);
      }
    } catch (err: any) {
      console.error("Scenario execution error:", err);
      // For local visual demonstration fallback
      if (act === "act3") {
        setActiveDecision({
          id: "dec-demo-contradiction",
          question: "Should the group discount apply to the refundable surcharge?",
          explanation: "Contributor A submitted a requirement that group discount applies to the total order, while Contributor B specified the refund guarantee fee is strictly non-discountable.",
          conflictingRequirementIds: ["req-a", "req-b"],
          options: [
            {
              id: "discount_tickets_only",
              label: "Apply group discount only to base tickets (Recommended)",
              description: "The 15% discount applies strictly to tickets. Refund fee ($5/ea) is paid in full.",
              concreteExample: "Four $40 refundable tickets cost: $156.00 ($160 × 0.85 + $20)",
            },
            {
              id: "discount_includes_refund",
              label: "Apply group discount to both tickets and refund surcharge",
              description: "The 15% discount applies to the entire basket including the refund surcharge.",
              concreteExample: "Four $40 refundable tickets cost: $153.00 ($160 × 0.85 + $20 × 0.85)",
            },
          ],
          status: "pending",
          createdAt: new Date().toISOString(),
        });
        setPipelineStage("decision_needed");
        setStatusMessage("Product Decision Required");
      }
    } finally {
      setIsRunningScenario(false);
      setActiveAct(null);
    }
  };

  const handleResolveDecision = async (decisionId: string, selectedOptionId: string) => {
    setIsResolvingDecision(true);
    try {
      await fetch("/api/decisions/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisionId, selectedOptionId }),
      });

      const appliesToRefund = selectedOptionId === "discount_includes_refund";
      setPolicy((prev) => ({
        ...prev,
        discountAppliesToRefundFee: appliesToRefund,
      }));

      setActiveDecision(null);
      setPipelineStage("accepted");
      setStatusMessage("Decision Applied & Integrated!");
      setStatusDetail("Repaired code verified in isolated sandbox and accepted to canonical main.");

      // Refresh state
      const stateRes = await fetch("/api/state");
      const newState = await stateRes.json() as FlareGitProjectState;
      setState(newState);
    } catch (err) {
      console.error("Failed to resolve decision:", err);
      // Fallback
      setPolicy((prev) => ({
        ...prev,
        discountAppliesToRefundFee: selectedOptionId === "discount_includes_refund",
      }));
      setActiveDecision(null);
      setPipelineStage("accepted");
    } finally {
      setIsResolvingDecision(false);
    }
  };

  const currentCommit = state?.acceptedState?.currentCommit || "b84a5f8";
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

      {/* 2. Real-time Status Banner */}
      <StatusBanner
        stage={pipelineStage}
        message={statusMessage}
        detail={statusDetail}
        lastAcceptedCommit={currentCommit}
      />

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
          <LivePreview currentCommit={currentCommit} policy={policy} />
        </div>
      </main>

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
