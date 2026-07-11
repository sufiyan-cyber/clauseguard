"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { TracesResponse } from "@/lib/types";
import { Card, Chip, EmptyState, SectionTitle, Spinner } from "@/components/ui";

export default function ObservabilityPage() {
  const [data, setData] = useState<TracesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .getTraces()
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && setError((e as Error).message));
    load();
    const interval = setInterval(load, 6000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  if (error) return <EmptyState title="Failed to load traces" hint={error} />;
  if (!data) return <Spinner label="Loading observability data…" />;

  const agents = Object.entries(data.aggregates);
  const totalTokens = agents.reduce((sum, [, a]) => sum + a.totalTokens, 0);
  const totalCalls = agents.reduce((sum, [, a]) => sum + a.calls, 0);

  return (
    <div className="space-y-8">
      <section className="animate-rise">
        <h1 className="text-xl font-semibold tracking-tight">LLM Observability</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-dim">
          Every agent call is traced: model version, token usage, latency, and a SHA-256 prompt
          hash (raw prompts are never stored). Correlation IDs tie traces to gateway requests
          end-to-end. Span-level traces are also visible in Mastra Studio.
        </p>
      </section>

      {/* Aggregate cards */}
      <section className="animate-rise">
        <SectionTitle
          right={
            <span className="text-xs text-ink-faint">
              {totalCalls} calls · {totalTokens.toLocaleString()} tokens
            </span>
          }
        >
          Per-agent aggregates
        </SectionTitle>
        {agents.length === 0 ? (
          <EmptyState title="No traces yet" hint="Run an analysis to populate telemetry." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map(([agent, a]) => (
              <Card key={agent} className="p-4">
                <p className="truncate font-mono text-[12px] font-semibold text-brand">{agent}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                  <Metric label="calls" value={String(a.calls)} />
                  <Metric label="tokens" value={a.totalTokens.toLocaleString()} />
                  <Metric label="avg latency" value={`${(a.avgLatencyMs / 1000).toFixed(1)}s`} />
                  <Metric
                    label="error rate"
                    value={`${Math.round(a.errorRate * 100)}%`}
                    tone={a.errorRate > 0.2 ? "bad" : a.errorRate > 0 ? "warn" : "good"}
                  />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Qdrant stats */}
      <section className="animate-rise">
        <SectionTitle>Qdrant collections</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          {Object.entries(data.qdrant).map(([name, s]) => (
            <Card key={name} className="flex items-center justify-between p-4">
              <div>
                <p className="font-mono text-[12px] font-semibold">{name}</p>
                <p className="mt-0.5 text-xs text-ink-faint">{s.points} points</p>
              </div>
              <Chip tone={s.status === "green" || s.status === "ok" ? "pass" : s.status === "missing" ? "fail" : "warn"}>
                {s.status}
              </Chip>
            </Card>
          ))}
          {Object.keys(data.qdrant).length === 0 && (
            <p className="text-xs text-ink-faint">Qdrant unreachable — check QDRANT_URL.</p>
          )}
        </div>
      </section>

      {/* Trace table */}
      <section className="animate-rise">
        <SectionTitle>Recent traces</SectionTitle>
        {data.traces.length === 0 ? (
          <EmptyState title="No traces recorded yet" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-edge">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-edge bg-raised/60 text-[10px] uppercase tracking-wider text-ink-faint">
                <tr>
                  <th className="px-3 py-2">Agent</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Tokens (in/out)</th>
                  <th className="px-3 py-2">Latency</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Prompt hash</th>
                  <th className="px-3 py-2">Correlation ID</th>
                  <th className="px-3 py-2">At</th>
                </tr>
              </thead>
              <tbody>
                {data.traces.map((t) => (
                  <tr key={t.id} className="border-b border-edge/50 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-ink">
                      {t.agentId}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-dim">
                      {t.model.replace("groq/", "")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-ink-dim">
                      {t.inputTokens ?? "—"} / {t.outputTokens ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-dim">
                      {(t.latencyMs / 1000).toFixed(1)}s
                    </td>
                    <td className="px-3 py-2">
                      <Chip tone={t.status === "ok" ? "pass" : "fail"} title={t.errorMessage ?? undefined}>
                        {t.status}
                      </Chip>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-ink-faint">
                      {t.promptHash.slice(0, 12)}…
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-ink-faint">
                      {t.correlationId ? `${t.correlationId.slice(0, 8)}…` : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-faint">
                      {new Date(t.createdAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className="rounded-lg bg-raised/70 px-2 py-2">
      <p
        className={`text-sm font-bold ${
          tone === "bad" ? "text-risk-high" : tone === "warn" ? "text-risk-medium" : tone === "good" ? "text-risk-low" : "text-ink"
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-ink-faint">{label}</p>
    </div>
  );
}
