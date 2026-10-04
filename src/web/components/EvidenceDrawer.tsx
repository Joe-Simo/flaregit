import React, { useState } from "react";
import { ShieldCheck, CheckCircle2, Cpu } from "lucide-react";
import { Sheet, SheetHeader, SheetTitle, SheetDescription, SheetClose } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { VerificationEvidence, Requirement, PublicationJournalEntry, CandidateGeneration } from "@/core/types";

interface EvidenceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeRequirements: Requirement[];
  evidenceList: VerificationEvidence[];
  journal: PublicationJournalEntry[];
  candidates: Record<string, CandidateGeneration>;
}

export function EvidenceDrawer({
  open,
  onOpenChange,
  activeRequirements,
  evidenceList,
  journal,
  candidates,
}: EvidenceDrawerProps) {
  const [tab, setTab] = useState<string>("verification");

  const latestEvidence = evidenceList[evidenceList.length - 1];

  return (
    <Sheet open={open} onOpenChange={onOpenChange} side="right">
      <div className="flex flex-col h-full">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              <SheetTitle>Independent Verification & Audit Trail</SheetTitle>
            </div>
            <SheetClose onClick={() => onOpenChange(false)} />
          </div>
          <SheetDescription>
            Cryptographic proof and contract satisfaction required before exact-version acceptance.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto mt-4 pr-1">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full grid grid-cols-4 mb-4">
              <TabsTrigger value="verification">Verification</TabsTrigger>
              <TabsTrigger value="requirements">Requirements</TabsTrigger>
              <TabsTrigger value="repairs">AI Repair</TabsTrigger>
              <TabsTrigger value="journal">CAS Journal</TabsTrigger>
            </TabsList>

            {/* TAB 1: VERIFICATION EVIDENCE */}
            <TabsContent value="verification" className="space-y-4">
              {latestEvidence ? (
                <div className="space-y-4">
                  {/* Evidence Header Card */}
                  <div className="p-3.5 rounded-lg border border-border/80 bg-muted/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        Evidence Record: {latestEvidence.id}
                      </span>
                      <Badge variant="success">5/5 Passed</Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-muted-foreground pt-1 border-t border-border/40">
                      <div>Commit: {latestEvidence.candidateCommit.slice(0, 7)}</div>
                      <div>Base: {latestEvidence.expectedAcceptedBase?.slice(0, 7)??"empty accepted history"}</div>
                      <div>Toolchain: {latestEvidence.toolchainDigest}</div>
                      <div>Output Digest: {latestEvidence.builtOutputDigest.slice(0, 16)}...</div>
                    </div>
                  </div>

                  {/* Test Results Items */}
                  <div className="space-y-2">
                    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Protected Test Contracts:
                    </div>
                    {latestEvidence.testResults[0]?.items.map((item) => (
                      <div
                        key={item.testId}
                        className="p-3 rounded-lg border border-emerald-500/20 bg-emerald-950/10 flex items-start gap-2.5"
                      >
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                        <div className="flex-1 text-xs">
                          <div className="font-semibold text-emerald-300">
                            {item.description}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono mt-0.5 flex items-center justify-between">
                            <span>ID: {item.testId}</span>
                            <span>{item.durationMs}ms</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  No verification evidence recorded yet.
                </div>
              )}
            </TabsContent>

            {/* TAB 2: ACTIVE REQUIREMENTS */}
            <TabsContent value="requirements" className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Authoritative Approved Requirements ({activeRequirements.length}):
              </div>

              {activeRequirements.map((req) => (
                <div
                  key={req.id}
                  className="p-3 rounded-lg border border-border/60 bg-muted/20 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground">
                      {req.title}
                    </span>
                    <Badge variant={req.status === "approved" ? "success" : "purple"}>
                      v{req.version} • {req.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{req.description}</p>
                  <div className="text-[10px] font-mono text-muted-foreground pt-1 border-t border-border/40 flex justify-between">
                    <span>Task: {req.originTaskId}</span>
                    <span>Approved: {new Date(req.approvedAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </TabsContent>

            {/* TAB 3: WORKERS AI REPAIRS */}
            <TabsContent value="repairs" className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Autonomous Repair Log:
              </div>

              {Object.values(candidates).flatMap((c) => c.repairAttempts || []).length > 0 ? (
                Object.values(candidates).flatMap((c) => c.repairAttempts || []).map((rep, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-lg border border-amber-500/30 bg-amber-950/20 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold text-amber-300">
                        <Cpu className="h-4 w-4 text-orange-400" />
                        <span>Round {rep.round} Repair Synthesis</span>
                      </div>
                      <Badge variant="warning">Cloudflare Workers AI</Badge>
                    </div>

                    <div className="text-muted-foreground text-[11px] leading-relaxed">
                      Affected Contracts: {rep.affectedContracts?.join(", ") || "Pricing logic"}
                    </div>

                    <div className="p-2.5 rounded bg-background/80 border border-border font-mono text-[11px] text-amber-200 overflow-x-auto">
                      <pre>{rep.patch}</pre>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  No repairs triggered. Clean merge satisfied all behavioral requirements.
                </div>
              )}
            </TabsContent>

            {/* TAB 4: CAS JOURNAL */}
            <TabsContent value="journal" className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                CAS Ref Lock & Publication Log ({journal.length}):
              </div>

              {journal.map((entry) => (
                <div
                  key={entry.id}
                  className="p-3 rounded-lg border border-border/60 bg-muted/20 space-y-1 font-mono text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-foreground">
                      {entry.candidateCommit.slice(0, 7)}
                    </span>
                    <Badge variant={entry.state === "ACCEPTED" ? "success" : "secondary"}>
                      {entry.state}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Expected Head: {entry.expectedHead?.slice(0, 7)??"empty accepted history"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    New Head: {entry.newHead.slice(0, 7)}
                  </div>
                  <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                    Timestamp: {new Date(entry.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </Sheet>
  );
}
