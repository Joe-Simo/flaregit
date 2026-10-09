import React, { useState } from "react";
import { AlertTriangle, Check, Shield } from "lucide-react";
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
  const [choice, setChoice] = useState<{ decisionId: string; optionId: string } | null>(null);

  if (!decision) return null;
  const selectedId = choice?.decisionId === decision.id && decision.options.some(option => option.id === choice.optionId) ? choice.optionId : "";

  return (
    <Dialog className="max-h-[calc(100dvh-2rem)] overflow-y-auto" open={true} onOpenChange={() => onDismiss()}>
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

      <div role="group" aria-label="Choose a requirement" className="space-y-3 my-4">
        {decision.options.map((opt) => {
          const isSelected = selectedId === opt.id;

          return (
            <Button
              type="button"
              variant="outline"
              key={opt.id}
              aria-pressed={isSelected}
              disabled={isResolving}
              onClick={() => setChoice({ decisionId: decision.id, optionId: opt.id })}
              className={`h-auto w-full whitespace-normal text-left p-4 rounded-lg border transition-all ${
                isSelected
                  ? "border-primary bg-primary/10 shadow-md shadow-primary/10"
                  : "border-border/60 bg-muted/30 hover:border-border hover:bg-muted/50"
              }`}
            >
              <span className="flex w-full items-start justify-between gap-3">
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">
                      {opt.label}
                    </span>
                    
                  </span>
                  <span className="block text-xs text-muted-foreground mt-1 font-normal">
                    {opt.description}
                  </span>
                  <span className="mt-2 text-xs font-mono font-medium text-emerald-400 bg-background/60 px-2.5 py-1 rounded border border-border/40 inline-block">
                    {opt.concreteExample}
                  </span>
                </span>

                <span
                  aria-hidden="true"
                  className={`h-5 w-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/40 bg-transparent"
                  }`}
                >
                  {isSelected && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                </span>
              </span>
            </Button>
          );
        })}
      </div>

      <div className="p-3 rounded-lg bg-background/50 border border-border/50 text-[11px] text-muted-foreground flex items-center gap-2">
        <Shield className="h-3.5 w-3.5 text-primary shrink-0" />
        <span>
          The accepted repository history stays unchanged. Your choice prepares a new combined preview; checks and human acceptance are separate steps.
        </span>
      </div>

      <DialogFooter className="mt-5">
        <Button variant="ghost" onClick={onDismiss} disabled={isResolving}>
          Decide later
        </Button>
        <Button
          variant="orange"
          onClick={() => onResolve(decision.id, selectedId)}
          disabled={isResolving || !selectedId}
          className="font-semibold gap-1.5"
        >
          <span>{isResolving ? "Saving choice…" : "Save choice & prepare combined preview"}</span>
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
