import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { changeSteps, type ChangeStepId } from "../lib/glossary";

export interface ChangeStepperProps {
  step: ChangeStepId;
  halted?: boolean;
  /** The one primary action for the current step; omitted when the viewer cannot act. */
  action?: React.ReactNode;
  className?: string;
}

/** One horizontal lifecycle per change: Contribution → Ready → Verifying → Needs review → Merged. */
export function ChangeStepper({ step, halted = false, action, className }: ChangeStepperProps) {
  const currentIndex = changeSteps.findIndex(item => item.id === step);
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <ol aria-label="Change progress" className="flex min-w-0 flex-1 items-center">
        {changeSteps.map((item, index) => {
          const done = index < currentIndex || (step === "merged" && index === currentIndex);
          const active = index === currentIndex && step !== "merged";
          return (
            <li key={item.id} aria-current={index === currentIndex ? "step" : undefined} title={item.hint} className="flex min-w-0 flex-1 items-center last:flex-none">
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                    done && "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500",
                    active && !halted && "border-primary bg-primary text-primary-foreground",
                    active && halted && "border-destructive bg-destructive text-destructive-foreground",
                    !done && !active && "border-border text-muted-foreground",
                  )}
                >
                  {done ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                <span className={cn("truncate text-xs", index === currentIndex ? "font-semibold text-foreground" : "sr-only text-muted-foreground md:not-sr-only")}>
                  {item.label}
                  <span className="sr-only">{done ? " (done)" : active ? halted ? " (current, stopped)" : " (current)" : " (upcoming)"}</span>
                </span>
              </span>
              {index < changeSteps.length - 1 && <span aria-hidden="true" className={cn("mx-1.5 h-px min-w-3 flex-1", index < currentIndex ? "bg-emerald-600 dark:bg-emerald-500" : "bg-border")} />}
            </li>
          );
        })}
      </ol>
      {action && <div className="shrink-0">{action}</div>}
      </div>
      {changeSteps[currentIndex] && <p className="text-xs text-muted-foreground">{halted ? "Stopped here. " : ""}{changeSteps[currentIndex].hint}</p>}
    </div>
  );
}
