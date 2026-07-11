"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Clause, RiskLevel } from "@/lib/types";
import { IconDatabase, IconShieldCheck, IconUserCheck } from "@/components/icons";
import { Button, Chip, Modal, RiskBadge } from "@/components/ui";

/* ---------------------------------------------------------------------------
 * HITL Gate 1 — risk review: confirm or override risk levels per clause.
 * Overrides feed the Qdrant review_memory learning loop.
 * ------------------------------------------------------------------------- */
export function RiskReviewModal({
  open,
  onClose,
  runId,
  clauses,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  runId: string | null;
  clauses: Clause[];
  onSubmitted: () => void;
}) {
  const [overrides, setOverrides] = useState<
    Record<number, { riskLevel?: RiskLevel; note?: string }>
  >({});
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flagged = useMemo(
    () =>
      [...clauses]
        .filter((c) => c.riskLevel)
        .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0)),
    [clauses],
  );

  const setOverride = (ordinal: number, patch: { riskLevel?: RiskLevel; note?: string }) =>
    setOverrides((prev) => ({ ...prev, [ordinal]: { ...prev[ordinal], ...patch } }));

  const submit = async (approved: boolean) => {
    if (!runId) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.approve(runId, {
        gate: "risk_review",
        approved,
        overrides: Object.entries(overrides)
          .filter(([, v]) => v.riskLevel || v.note)
          .map(([ordinal, v]) => ({ ordinal: Number(ordinal), ...v })),
        reviewerNotes: notes || undefined,
      });
      onSubmitted();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const overrideCount = Object.values(overrides).filter((o) => o.riskLevel).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Human Gate 1 · Risk review"
      subtitle="Findings are grounded in Qdrant benchmarks and verified by Enkrypt G1. Your overrides are embedded into review memory and calibrate every future analysis."
      wide
    >
      <div className="max-h-[46vh] space-y-2.5 overflow-y-auto pr-1">
        {flagged.map((clause) => {
          const ov = overrides[clause.ordinal];
          return (
            <div key={clause.id} className="rounded-lg border border-edge bg-raised/40 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] font-bold tabular-nums text-ink-faint">
                  #{clause.ordinal}
                </span>
                <span className="text-[13px] font-bold">
                  {clause.heading ?? clause.clauseType?.replaceAll("_", " ") ?? "clause"}
                </span>
                <RiskBadge level={clause.riskLevel} score={clause.riskScore} />
                <label className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-faint">
                  override
                  <select
                    className="min-h-9 rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink transition-colors duration-150 hover:border-edge-strong"
                    value={ov?.riskLevel ?? ""}
                    onChange={(e) =>
                      setOverride(clause.ordinal, {
                        riskLevel: (e.target.value || undefined) as RiskLevel | undefined,
                      })
                    }
                  >
                    <option value="">keep {clause.riskLevel}</option>
                    {(["low", "medium", "high"] as RiskLevel[])
                      .filter((l) => l !== clause.riskLevel)
                      .map((l) => (
                        <option key={l} value={l}>
                          → {l}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {clause.riskRationale && (
                <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-ink-dim">
                  {clause.riskRationale}
                </p>
              )}
              {ov?.riskLevel && (
                <div className="mt-2 flex items-center gap-2">
                  <IconUserCheck size={13} className="shrink-0 text-risk-medium" />
                  <input
                    placeholder="Why? This note teaches future analyses (stored in review memory)"
                    className="min-h-9 w-full rounded-md border border-risk-medium/40 bg-surface px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint"
                    value={ov.note ?? ""}
                    onChange={(e) => setOverride(clause.ordinal, { note: e.target.value })}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-[11px] font-semibold text-ink-faint">
          Overall reviewer notes (optional)
        </span>
        <textarea
          className="w-full rounded-lg border border-edge bg-raised/40 px-3 py-2 text-xs text-ink placeholder:text-ink-faint"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Context for the audit trail…"
        />
      </label>
      {error && (
        <p className="mt-2 text-xs font-medium text-risk-high" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Button variant="danger" onClick={() => submit(false)} disabled={submitting}>
          Reject analysis
        </Button>
        <div className="flex items-center gap-2.5">
          <Chip tone={overrideCount > 0 ? "warn" : "neutral"}>
            {overrideCount} override{overrideCount === 1 ? "" : "s"}
          </Chip>
          <Button variant="success" onClick={() => submit(true)} disabled={submitting}>
            <IconShieldCheck size={14} />
            {submitting ? "Resuming workflow…" : "Approve & generate redlines"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------
 * HITL Gate 2 — final approval: approve / edit / reject each proposed redline.
 * ------------------------------------------------------------------------- */
export function FinalApprovalModal({
  open,
  onClose,
  runId,
  clauses,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  runId: string | null;
  clauses: Clause[];
  onSubmitted: () => void;
}) {
  const proposed = useMemo(
    () => clauses.filter((c) => c.redlineStatus === "proposed" && c.redlineText),
    [clauses],
  );
  const [decisions, setDecisions] = useState<
    Record<number, { action: "approve" | "edit" | "reject"; editedText?: string; note?: string }>
  >({});
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setDecision = (
    ordinal: number,
    patch: Partial<{ action: "approve" | "edit" | "reject"; editedText: string; note: string }>,
  ) =>
    setDecisions((prev) => {
      const current = prev[ordinal] ?? { action: "approve" as const };
      return { ...prev, [ordinal]: { ...current, ...patch } };
    });

  const submit = async (approved: boolean) => {
    if (!runId) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.approve(runId, {
        gate: "final_approval",
        approved,
        decisions: proposed.map((c) => ({
          ordinal: c.ordinal,
          action: decisions[c.ordinal]?.action ?? "approve",
          editedText:
            decisions[c.ordinal]?.action === "edit" ? decisions[c.ordinal]?.editedText : undefined,
          note: decisions[c.ordinal]?.note,
        })),
        reviewerNotes: notes || undefined,
      });
      onSubmitted();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Human Gate 2 · Final approval"
      subtitle="Each redline passed Enkrypt G3 (PII, toxicity, policy, grounding). Approve, edit, or reject — your rulings train the redline agent via review memory."
      wide
    >
      <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
        {proposed.map((clause) => {
          const d = decisions[clause.ordinal];
          const action = d?.action ?? "approve";
          return (
            <div key={clause.id} className="rounded-lg border border-edge bg-raised/40 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] font-bold tabular-nums text-ink-faint">
                  #{clause.ordinal}
                </span>
                <span className="text-[13px] font-bold">
                  {clause.heading ?? clause.clauseType?.replaceAll("_", " ")}
                </span>
                <RiskBadge level={clause.riskLevel} score={clause.riskScore} />
                <div className="ml-auto flex gap-1" role="radiogroup" aria-label="Redline decision">
                  {(["approve", "edit", "reject"] as const).map((a) => (
                    <button
                      key={a}
                      role="radio"
                      aria-checked={action === a}
                      onClick={() =>
                        setDecision(clause.ordinal, {
                          action: a,
                          editedText:
                            a === "edit" ? (d?.editedText ?? clause.redlineText ?? "") : d?.editedText,
                        })
                      }
                      className={`min-h-9 rounded-md border px-3 py-1.5 text-[11px] font-bold transition-colors duration-150 ${
                        action === a
                          ? a === "approve"
                            ? "border-risk-low bg-risk-low/15 text-risk-low"
                            : a === "edit"
                              ? "border-risk-medium bg-risk-medium/15 text-risk-medium"
                              : "border-risk-high bg-risk-high/15 text-risk-high"
                          : "border-edge text-ink-faint hover:border-edge-strong hover:text-ink"
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              {action === "edit" ? (
                <textarea
                  className="mt-2.5 w-full rounded-md border border-risk-medium/40 bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed text-ink"
                  rows={5}
                  value={d?.editedText ?? clause.redlineText ?? ""}
                  onChange={(e) => setDecision(clause.ordinal, { editedText: e.target.value })}
                  aria-label={`Edit redline for clause ${clause.ordinal}`}
                />
              ) : (
                <p className="mt-2.5 line-clamp-4 whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ink-dim">
                  {clause.redlineText}
                </p>
              )}
              <input
                placeholder="Note (optional — stored in review memory)"
                className="mt-2 min-h-9 w-full rounded-md border border-edge bg-surface px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint"
                value={d?.note ?? ""}
                onChange={(e) => setDecision(clause.ordinal, { note: e.target.value })}
                aria-label={`Note for clause ${clause.ordinal}`}
              />
            </div>
          );
        })}
        {proposed.length === 0 && (
          <p className="py-6 text-center text-sm text-ink-faint">
            No redlines pending — every risky clause was either blocked by G3 or already decided.
          </p>
        )}
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-[11px] font-semibold text-ink-faint">
          Overall reviewer notes (optional)
        </span>
        <textarea
          className="w-full rounded-lg border border-edge bg-raised/40 px-3 py-2 text-xs text-ink placeholder:text-ink-faint"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Context for the audit trail…"
        />
      </label>
      {error && (
        <p className="mt-2 text-xs font-medium text-risk-high" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex items-center justify-between gap-3">
        <Button variant="danger" onClick={() => submit(false)} disabled={submitting}>
          Reject
        </Button>
        <Button variant="success" onClick={() => submit(true)} disabled={submitting}>
          <IconDatabase size={14} />
          {submitting ? "Compiling final report…" : "Approve & compile report"}
        </Button>
      </div>
    </Modal>
  );
}
