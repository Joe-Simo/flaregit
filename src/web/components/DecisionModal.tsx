import React, { useState } from "react";
import { AlertTriangle, Check, Shield, Sparkles } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ProductDecision } from "@/core/types";

interface DecisionModalProps {
  decision: ProductDecision | null;
  onResolve: (decisionId: string, selectedOptionId: string) => void;
  onDismiss: () => void;
  isResolving: boolean;
}

export function DecisionModal({
  decision,
  onResolve,
  onDismiss,
  isResolving,
}: DecisionModalProps) {
  const [chosen, setChosen] = useState<string>("");

  if (!decision) return null;
  const selectedId = chosen || decision.options[0]?.id || "";
  const setSelectedId = setChosen;

  return (
    <Dialog open={true} onOpenChange={() => onDismiss()}>
      <DialogHeader>
        <div className="flex items-center gap-2 mb-1">
          <div className="p-1.5 rounded-md bg-purple-500/20 text-purple-400 border border-purple-500/30">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <Badge variant="purple">Product Decision Required</Badge>
        </div>
        <DialogTitle className="text-lg font-bold text-foreground">
          {decision.question}
        </DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground leading-relaxed mt-1">
          {decision.explanation}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 my-4">
        {decision.options.map((opt) => {
          const isSelected = selectedId === opt.id;

          return (
            <div
              key={opt.id}
              onClick={() => setSelectedId(opt.id)}
              className={`p-4 rounded-xl border transition-all cursor-pointer ${
                isSelected
                  ? "border-primary bg-primary/10 shadow-md shadow-primary/10"
                  : "border-border/60 bg-muted/30 hover:border-border hover:bg-muted/50"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">
                      {opt.label}
                    </span>
                    
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {opt.description}
                  </p>
                  <div className="mt-2 text-xs font-mono font-medium text-emerald-400 bg-background/60 px-2.5 py-1 rounded border border-border/40 inline-block">
                    {opt.concreteExample}
                  </div>
                </div>

                <div
                  className={`h-5 w-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/40 bg-transparent"
                  }`}
                >
                  {isSelected && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-3 rounded-lg bg-background/50 border border-border/50 text-[11px] text-muted-foreground flex items-center gap-2">
        <Shield className="h-3.5 w-3.5 text-primary shrink-0" />
        <span>
          <strong>Zero downtime guarantee:</strong> Canonical main remains safely preserved at the last accepted version until verification passes.
        </span>
      </div>

      <DialogFooter className="mt-5">
        <Button variant="ghost" onClick={onDismiss} disabled={isResolving}>
          Keep Safe State
        </Button>
        <Button
          variant="orange"
          onClick={() => onResolve(decision.id, selectedId)}
          disabled={isResolving}
          className="font-semibold gap-1.5"
        >
          <Sparkles className="h-4 w-4" />
          <span>Apply Choice & Auto-Integrate</span>
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
