"use client";

import type { RunState } from "@/lib/types";
import { IconCheck, IconPause, IconX } from "@/components/icons";

const PIPELINE: Array<{ id: string; label: string; gate?: boolean }> = [
  { id: "parseDocument", label: "Parse" },
  { id: "classifyClauses", label: "Classify" },
  { id: "indexClauses", label: "Index · Qdrant" },
  { id: "analyzeRisk", label: "Risk · G1" },
  { id: "riskReviewGate", label: "Human review", gate: true },
  { id: "generateRedlines", label: "Redlines · G3" },
  { id: "finalApprovalGate", label: "Final approval", gate: true },
  { id: "compileReport", label: "Report · G4" },
];

type StepStatus = "pending" | "active" | "done" | "failed" | "suspended";

export function RunProgress({ run, status }: { run: RunState | null; status: string }) {
  const stepState = (stepId: string): StepStatus => {
    const entries = run?.stepLog.filter((s) => s.step === stepId) ?? [];
    const last = entries[entries.length - 1];
    if (!last) {
      if (status === "completed") return "done";
      return "pending";
    }
    if (last.status === "completed") return "done";
    if (last.status === "failed") return "failed";
    if (last.status === "suspended") return status === "completed" ? "done" : "suspended";
    return "active";
  };

  if (!run && status === "completed") return null;
  if (status === "uploaded" || status === "") return null;

  const lastLog = run?.stepLog[run.stepLog.length - 1];

  return (
    <div className="animate-rise overflow-x-auto rounded-xl border border-edge bg-surface/90 p-4">
      <ol className="flex min-w-max items-center" aria-label="Workflow progress">
        {PIPELINE.map((step, i) => {
          const state = stepState(step.id);
          return (
            <li key={step.id} className="flex items-center">
              {i > 0 && (
                <span
                  aria-hidden
                  className={`mx-1.5 h-px w-6 transition-colors duration-300 sm:w-9 ${
                    state === "pending" ? "bg-edge" : "bg-brand/50"
                  }`}
                />
              )}
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={`grid size-8 place-items-center rounded-full border text-[11px] font-bold transition-colors duration-200 ${
                    state === "done"
                      ? "border-risk-low/50 bg-risk-low/15 text-risk-low"
                      : state === "active"
                        ? "animate-pulse-soft border-brand bg-brand/15 text-brand-strong"
                        : state === "suspended"
                          ? "border-risk-medium bg-risk-medium/15 text-risk-medium"
                          : state === "failed"
                            ? "border-risk-high bg-risk-high/15 text-risk-high"
                            : "border-edge bg-raised text-ink-faint"
                  }`}
                >
                  {state === "done" ? (
                    <IconCheck size={13} />
                  ) : state === "failed" ? (
                    <IconX size={13} />
                  ) : step.gate ? (
                    <IconPause size={12} />
                  ) : (
                    <span className="tabular-nums">{i + 1}</span>
                  )}
                </span>
                <span
                  className={`whitespace-nowrap text-[10px] font-semibold ${
                    state === "pending" ? "text-ink-faint" : "text-ink-dim"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {lastLog && (
        <p className="mt-3 border-t border-edge pt-2.5 font-mono text-[11px] tabular-nums text-ink-faint">
          {new Date(lastLog.at).toLocaleTimeString()} — {lastLog.step}: {lastLog.status}
          {lastLog.detail ? ` (${lastLog.detail})` : ""}
        </p>
      )}
    </div>
  );
}
