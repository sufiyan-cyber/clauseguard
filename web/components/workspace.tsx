"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, subscribeToRun } from "@/lib/api";
import type { Clause, DocumentDetail, RunState } from "@/lib/types";
import { AuditPanel } from "@/components/audit-panel";
import { ClauseCard } from "@/components/clause-card";
import { FinalApprovalModal, RiskReviewModal } from "@/components/gates";
import {
  IconAlertTriangle,
  IconChevronRight,
  IconClipboardList,
  IconFileText,
  IconMessageSquare,
  IconPause,
  IconRefresh,
} from "@/components/icons";
import { QaChat } from "@/components/qa-chat";
import { RunProgress } from "@/components/run-progress";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  RiskBadge,
  SectionTitle,
  SkeletonRows,
  StatusPill,
} from "@/components/ui";

type Tab = "clauses" | "qa" | "audit";

export function Workspace({ documentId }: { documentId: string }) {
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [tab, setTab] = useState<Tab>("clauses");
  const [gateOpen, setGateOpen] = useState<"risk_review" | "final_approval" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);

  const refreshDetail = useCallback(async () => {
    try {
      const d = await api.getDocument(documentId);
      setDetail(d);
      setError(null);
      return d;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, [documentId]);

  // Initial load + SSE subscription to the active run
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const d = await refreshDetail();
      const runId = d?.document.workflowRunId;
      if (!runId || cancelled) return;
      unsubscribe = subscribeToRun(
        runId,
        (state) => {
          setRun(state);
          // Refresh clause data whenever the pipeline reaches a decision point
          if (
            state.status.startsWith("suspended") ||
            state.status === "completed" ||
            state.status === "failed"
          ) {
            refreshDetail();
          }
        },
        () => refreshDetail(),
      );
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [documentId, refreshDetail]);

  // Light polling fallback while the workflow is active (covers SSE hiccups)
  useEffect(() => {
    const active =
      detail &&
      !["completed", "failed", "uploaded"].includes(detail.document.status);
    if (!active) return;
    const interval = setInterval(refreshDetail, 6000);
    return () => clearInterval(interval);
  }, [detail, refreshDetail]);

  const clauses = detail?.clauses ?? [];
  const riskCounts = useMemo(
    () => ({
      high: clauses.filter((c) => c.riskLevel === "high").length,
      medium: clauses.filter((c) => c.riskLevel === "medium").length,
      low: clauses.filter((c) => c.riskLevel === "low").length,
    }),
    [clauses],
  );

  const status = detail?.document.status ?? "";
  const report = detail?.document.report ?? null;

  const scrollToClause = (ordinal: number) => {
    setTab("clauses");
    setHighlight(ordinal);
    setTimeout(() => {
      document.getElementById(`clause-${ordinal}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    setTimeout(() => setHighlight(null), 2600);
  };

  if (!detail) {
    return error ? (
      <EmptyState title="Failed to load document" hint={error} />
    ) : (
      <SkeletonRows rows={4} height={96} />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-rise flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-serif text-2xl font-semibold tracking-tight">
            {detail.document.title ?? detail.document.filename}
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-xs tabular-nums text-ink-faint">
            <IconFileText size={12} />
            {detail.document.filename} · uploaded{" "}
            {new Date(detail.document.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {clauses.length > 0 && (
            <div className="flex gap-1.5">
              <Chip tone="fail">{riskCounts.high} high</Chip>
              <Chip tone="warn">{riskCounts.medium} medium</Chip>
              <Chip tone="pass">{riskCounts.low} low</Chip>
            </div>
          )}
          <StatusPill status={status} />
        </div>
      </div>

      {/* Workflow progress + HITL banners */}
      <RunProgress run={run} status={status} />

      {status === "awaiting_risk_review" && (
        <GateBanner
          tone="warn"
          title="HITL Gate 1 — Risk findings need your review"
          body="The riskAnalysisAgent has scored every clause against Qdrant market benchmarks and passed Enkrypt G1 grounding checks. Confirm or override before redlines are drafted."
          action={<Button onClick={() => setGateOpen("risk_review")}>Review findings</Button>}
        />
      )}
      {status === "awaiting_final_approval" && (
        <GateBanner
          tone="warn"
          title="HITL Gate 2 — Redlines await final approval"
          body="Safer alternative language passed Enkrypt G3 safety scans. Approve, edit, or reject each redline to finish the review."
          action={<Button onClick={() => setGateOpen("final_approval")}>Review redlines</Button>}
        />
      )}
      {status === "failed" && (
        <GateBanner
          tone="fail"
          title="Analysis failed"
          body={detail.document.errorMessage ?? "Unknown error"}
          action={
            <Button
              variant="ghost"
              onClick={async () => {
                await api.analyze(documentId);
                const d = await refreshDetail();
                const runId = d?.document.workflowRunId;
                if (runId) subscribeToRun(runId, setRun, () => refreshDetail());
              }}
            >
              <IconRefresh size={14} />
              Retry analysis
            </Button>
          }
        />
      )}

      {/* Final report */}
      {report && (
        <Card className="animate-rise border-risk-low/30 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg font-semibold">Final report</h2>
            <RiskBadge level={report.overallRisk} />
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
            {report.executiveSummary}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-ink-faint">
                Top concerns
              </p>
              <ul className="space-y-1.5 text-sm text-ink-dim">
                {report.topConcerns.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <IconChevronRight size={13} className="mt-0.5 shrink-0 text-risk-high" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-ink-faint">
                Recommendations
              </p>
              <ul className="space-y-1.5 text-sm text-ink-dim">
                {report.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <IconChevronRight size={13} className="mt-0.5 shrink-0 text-risk-low" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-edge pt-4 sm:grid-cols-4">
            {[
              [String(report.stats.totalClauses), "clauses analyzed"],
              [`${report.stats.high}/${report.stats.medium}/${report.stats.low}`, "high / med / low"],
              [String(report.stats.redlinesApproved), "redlines approved"],
              [String(report.stats.humanOverrides), "human overrides"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-lg bg-raised/60 px-3 py-2.5 text-center">
                <p className="text-base font-bold tabular-nums">{value}</p>
                <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-faint">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Risk heatmap strip */}
      {clauses.length > 0 && (
        <div className="animate-rise">
          <SectionTitle
            right={
              <span className="flex items-center gap-3 text-[10px] font-medium text-ink-faint">
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-risk-high-strong" aria-hidden /> high
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-risk-medium-strong" aria-hidden /> medium
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-risk-low-strong" aria-hidden /> low
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-raised ring-1 ring-edge" aria-hidden /> pending
                </span>
              </span>
            }
          >
            Risk heatmap — click to jump
          </SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {clauses.map((c) => (
              <button
                key={c.id}
                title={`Clause ${c.ordinal}${c.clauseType ? ` · ${c.clauseType.replaceAll("_", " ")}` : ""}${c.riskLevel ? ` · ${c.riskLevel} ${c.riskScore ?? ""}` : " · pending"}`}
                aria-label={`Jump to clause ${c.ordinal}${c.riskLevel ? `, ${c.riskLevel} risk` : ""}`}
                onClick={() => scrollToClause(c.ordinal)}
                className={`h-8 min-w-8 rounded-md px-1.5 font-mono text-[11px] font-bold tabular-nums transition-transform duration-150 hover:-translate-y-0.5 ${
                  c.riskLevel === "high"
                    ? "bg-risk-high-strong/85 text-base"
                    : c.riskLevel === "medium"
                      ? "bg-risk-medium-strong/85 text-base"
                      : c.riskLevel === "low"
                        ? "bg-risk-low-strong/75 text-base"
                        : "bg-raised text-ink-faint ring-1 ring-edge"
                }`}
              >
                {c.ordinal}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-edge" role="tablist" aria-label="Document views">
        <div className="flex gap-1">
          {(
            [
              ["clauses", `Clauses (${clauses.length})`, IconFileText],
              ["qa", "Q&A", IconMessageSquare],
              ["audit", "Audit trail", IconClipboardList],
            ] as [Tab, string, typeof IconFileText][]
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`inline-flex min-h-10 items-center gap-2 rounded-t-lg px-4 py-2 text-sm transition-colors duration-150 ${
                tab === key
                  ? "border border-b-0 border-edge bg-surface font-bold text-ink"
                  : "text-ink-dim hover:text-ink"
              }`}
            >
              <Icon size={14} className={tab === key ? "text-brand-strong" : undefined} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "clauses" &&
        (clauses.length === 0 ? (
          <EmptyState
            title="No clauses yet"
            hint="Clauses appear as soon as the docParserAgent finishes segmenting the document."
          />
        ) : (
          <div className="space-y-3">
            {clauses.map((clause: Clause) => (
              <ClauseCard key={clause.id} clause={clause} highlight={highlight === clause.ordinal} />
            ))}
          </div>
        ))}

      {tab === "qa" && <QaChat documentId={documentId} onCitationClick={scrollToClause} />}
      {tab === "audit" && <AuditPanel documentId={documentId} />}

      {/* HITL modals */}
      <RiskReviewModal
        open={gateOpen === "risk_review"}
        onClose={() => setGateOpen(null)}
        runId={detail.document.workflowRunId}
        clauses={clauses}
        onSubmitted={() => {
          setGateOpen(null);
          refreshDetail();
        }}
      />
      <FinalApprovalModal
        open={gateOpen === "final_approval"}
        onClose={() => setGateOpen(null)}
        runId={detail.document.workflowRunId}
        clauses={clauses}
        onSubmitted={() => {
          setGateOpen(null);
          refreshDetail();
        }}
      />
    </div>
  );
}

function GateBanner({
  tone,
  title,
  body,
  action,
}: {
  tone: "warn" | "fail";
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={`animate-rise flex flex-wrap items-center gap-4 rounded-xl border p-4 ${
        tone === "warn" ? "border-risk-medium/40 bg-risk-medium/5" : "border-risk-high/40 bg-risk-high/5"
      }`}
      role="status"
    >
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-lg border ${
          tone === "warn"
            ? "border-risk-medium/40 bg-risk-medium/10 text-risk-medium"
            : "border-risk-high/40 bg-risk-high/10 text-risk-high"
        }`}
        aria-hidden
      >
        {tone === "warn" ? <IconPause size={17} /> : <IconAlertTriangle size={17} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-bold ${tone === "warn" ? "text-risk-medium" : "text-risk-high"}`}>
          {title}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-dim">{body}</p>
      </div>
      {action}
    </div>
  );
}
