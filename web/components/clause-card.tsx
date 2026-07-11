"use client";

import { useState } from "react";
import type { Clause } from "@/lib/types";
import { IconDatabase, IconGitCompare, IconShieldCheck, IconUserCheck } from "@/components/icons";
import { Card, Chip, RiskBadge } from "@/components/ui";

export function ClauseCard({ clause, highlight }: { clause: Clause; highlight?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasRedline = clause.redlineText && clause.redlineStatus !== "none";

  return (
    <Card
      className={`animate-rise p-4 transition-shadow duration-200 ${
        highlight ? "border-brand ring-2 ring-brand/40" : ""
      }`}
    >
      <div id={`clause-${clause.ordinal}`} className="scroll-mt-24">
        {/* Header row */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md border border-edge bg-raised font-mono text-[11px] font-bold tabular-nums text-ink-dim">
            {clause.ordinal}
          </span>
          {clause.heading && <span className="text-sm font-bold">{clause.heading}</span>}
          {clause.clauseType && <Chip tone="brand">{clause.clauseType.replaceAll("_", " ")}</Chip>}
          <div className="ml-auto flex items-center gap-2">
            {clause.humanOverride && (
              <Chip tone="warn" title={clause.humanOverride.note ?? undefined}>
                <IconUserCheck size={10} />
                override: {clause.humanOverride.from ?? "?"} → {clause.humanOverride.to}
              </Chip>
            )}
            <RiskBadge level={clause.riskLevel} score={clause.riskScore} />
          </div>
        </div>

        {/* Risk score bar */}
        {typeof clause.riskScore === "number" && (
          <div
            className="mt-3 h-1 w-full overflow-hidden rounded-full bg-raised"
            role="meter"
            aria-valuenow={clause.riskScore}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Risk score ${clause.riskScore} of 100`}
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                clause.riskLevel === "high"
                  ? "bg-risk-high-strong"
                  : clause.riskLevel === "medium"
                    ? "bg-risk-medium-strong"
                    : "bg-risk-low-strong"
              }`}
              style={{ width: `${clause.riskScore}%` }}
            />
          </div>
        )}

        {/* Clause text */}
        <p
          className={`mt-3 whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-ink-dim ${
            !expanded && clause.text.length > 420 ? "line-clamp-4" : ""
          }`}
        >
          {clause.text}
        </p>
        {clause.text.length > 420 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1.5 text-[11px] font-bold text-brand-strong transition-colors duration-150 hover:text-brand"
            aria-expanded={expanded}
          >
            {expanded ? "Show less" : "Show full clause"}
          </button>
        )}

        {/* Risk rationale + benchmarks */}
        {clause.riskRationale && (
          <div className="mt-3 rounded-lg border border-edge bg-raised/50 p-3.5">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-faint">
              <IconShieldCheck size={12} className="text-brand-strong" />
              Risk analysis · grounded via Enkrypt G1
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink">{clause.riskRationale}</p>
            {clause.benchmarkRefs.length > 0 && (
              <div className="mt-2.5 space-y-1.5 border-t border-edge pt-2.5">
                {clause.benchmarkRefs.map((b) => (
                  <p key={b.label} className="flex gap-2 text-[11px] leading-relaxed text-ink-faint">
                    <IconDatabase size={11} className="mt-0.5 shrink-0 text-brand-strong/70" />
                    <span>
                      <span className="font-mono font-bold text-brand-strong">[{b.label}]</span>{" "}
                      <span className="text-ink-dim">
                        {b.clauseType?.replaceAll("_", " ")} · {b.jurisdiction} · baseline{" "}
                        {b.riskBaseline}
                      </span>
                      {b.snippet ? ` — “${b.snippet.slice(0, 140)}…”` : ""}
                    </span>
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Redline */}
        {hasRedline && (
          <div className="mt-3.5">
            <div className="mb-2 flex items-center gap-2">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                <IconGitCompare size={12} className="text-brand-strong" />
                Proposed redline · scanned via Enkrypt G3
              </p>
              <Chip
                tone={
                  clause.redlineStatus === "approved" || clause.redlineStatus === "edited"
                    ? "pass"
                    : clause.redlineStatus === "rejected"
                      ? "fail"
                      : "warn"
                }
              >
                {clause.redlineStatus}
              </Chip>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              <div className="rounded-lg border border-risk-high/25 bg-risk-high/5 p-3.5">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-risk-high/90">
                  − Original
                </p>
                <p className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ink-dim">
                  {clause.text}
                </p>
              </div>
              <div className="rounded-lg border border-risk-low/25 bg-risk-low/5 p-3.5">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-risk-low/90">
                  + Safer alternative
                </p>
                <p className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ink">
                  {clause.redlineText}
                </p>
              </div>
            </div>
            {clause.redlineRationale && (
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
                <span className="font-bold text-ink">Why: </span>
                {clause.redlineRationale}
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
