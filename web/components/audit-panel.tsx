"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { HumanFeedback, Verdict } from "@/lib/types";
import { IconShieldCheck, IconUserCheck } from "@/components/icons";
import { Chip, EmptyState, SectionTitle, SkeletonRows } from "@/components/ui";

const GATE_LABELS: Record<string, string> = {
  G1: "G1 · Risk grounding",
  G2: "G2 · Q&A grounding",
  G3: "G3 · Redline safety",
  G4: "G4 · Final compliance",
};

export function AuditPanel({ documentId }: { documentId: string }) {
  const [verdicts, setVerdicts] = useState<Verdict[] | null>(null);
  const [feedback, setFeedback] = useState<HumanFeedback[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .getAudit(documentId)
        .then((r) => {
          if (!alive) return;
          setVerdicts(r.verdicts);
          setFeedback(r.humanFeedback);
        })
        .catch(() => {});
    load();
    const interval = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [documentId]);

  if (!verdicts) return <SkeletonRows rows={3} height={64} />;

  const counts = {
    pass: verdicts.filter((v) => v.verdict === "pass").length,
    warn: verdicts.filter((v) => v.verdict === "warn").length,
    fail: verdicts.filter((v) => v.verdict === "fail").length,
  };

  return (
    <div className="animate-rise grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div>
        <SectionTitle
          right={
            <div className="flex gap-1.5">
              <Chip tone="pass">{counts.pass} pass</Chip>
              <Chip tone="warn">{counts.warn} warn</Chip>
              <Chip tone="fail">{counts.fail} fail</Chip>
            </div>
          }
        >
          <span className="inline-flex items-center gap-1.5">
            <IconShieldCheck size={13} className="text-brand-strong" />
            Enkrypt AI safety verdicts
          </span>
        </SectionTitle>
        {verdicts.length === 0 ? (
          <EmptyState title="No verdicts yet" hint="Gates fire as the workflow progresses." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-edge">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-edge bg-raised/60 text-[10px] uppercase tracking-wider text-ink-faint">
                <tr>
                  <th className="px-3 py-2">Gate</th>
                  <th className="px-3 py-2">Subject</th>
                  <th className="px-3 py-2">Verdict</th>
                  <th className="px-3 py-2">Scores</th>
                  <th className="px-3 py-2">Latency</th>
                  <th className="px-3 py-2">At</th>
                </tr>
              </thead>
              <tbody>
                {verdicts.slice(0, 60).map((v) => (
                  <tr key={v.id} className="border-b border-edge/50 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">
                      {GATE_LABELS[v.gate] ?? v.gate}
                    </td>
                    <td className="px-3 py-2 text-ink-dim">{v.subjectType}</td>
                    <td className="px-3 py-2">
                      <Chip
                        tone={
                          v.verdict === "pass" ? "pass" : v.verdict === "fail" ? "fail" : "warn"
                        }
                      >
                        {v.verdict}
                      </Chip>
                    </td>
                    <td className="max-w-56 truncate px-3 py-2 font-mono text-[10px] text-ink-faint">
                      {Object.entries(v.scores)
                        .filter(([k]) => k !== "mode")
                        .slice(0, 3)
                        .map(([k, val]) =>
                          `${k}=${typeof val === "number" ? (val as number).toFixed(2) : val}`,
                        )
                        .join(" ") || String(v.scores.mode ?? "")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-faint">
                      {v.latencyMs != null ? `${v.latencyMs}ms` : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-faint">
                      {new Date(v.createdAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <SectionTitle>
          <span className="inline-flex items-center gap-1.5">
            <IconUserCheck size={13} className="text-brand-strong" />
            Human decisions (learning loop)
          </span>
        </SectionTitle>
        {feedback.length === 0 ? (
          <EmptyState
            title="No human decisions yet"
            hint="Approvals, overrides, and redline edits at the two HITL gates appear here and are embedded into Qdrant review_memory."
          />
        ) : (
          <ol className="space-y-2">
            {feedback.map((f) => (
              <li key={f.id} className="rounded-lg border border-edge bg-raised/50 p-3">
                <div className="flex items-center gap-2">
                  <Chip tone={f.action.includes("reject") ? "fail" : f.action.includes("overrid") ? "warn" : "pass"}>
                    {f.action}
                  </Chip>
                  <span className="text-[11px] text-ink-faint">
                    {f.gate.replaceAll("_", " ")} · {new Date(f.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                {(f.fromValue as { riskLevel?: string } | null)?.riskLevel && (
                  <p className="mt-1.5 font-mono text-[11px] text-ink-dim">
                    {(f.fromValue as { riskLevel: string }).riskLevel} →{" "}
                    {(f.toValue as { riskLevel?: string } | null)?.riskLevel ?? "?"}
                  </p>
                )}
                {f.note && <p className="mt-1 text-[12px] italic text-ink-dim">“{f.note}”</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
