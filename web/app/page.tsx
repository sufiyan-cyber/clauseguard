"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type { DocumentSummary } from "@/lib/types";
import {
  IconClipboardList,
  IconDatabase,
  IconFileText,
  IconLayers,
  IconShieldCheck,
  IconUpload,
  IconUserCheck,
  IconZap,
} from "@/components/icons";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  SectionTitle,
  SkeletonRows,
  Spinner,
  StatusPill,
} from "@/components/ui";

const PIPELINE_STEPS = [
  { icon: IconFileText, label: "Parse & classify", detail: "2 agents segment verbatim clauses" },
  { icon: IconDatabase, label: "Benchmark", detail: "Qdrant hybrid search vs market standards" },
  { icon: IconShieldCheck, label: "Score & gate", detail: "Risk analysis behind Enkrypt G1" },
  { icon: IconUserCheck, label: "Human review", detail: "Two approval gates, every decision learned" },
  { icon: IconClipboardList, label: "Redline & report", detail: "Safer language, full audit trail" },
];

export default function HomePage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [docs, h] = await Promise.all([api.listDocuments(), api.health()]);
      setDocuments(docs.documents);
      setHealth(h);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { documentId } = await api.uploadDocument(file);
      await api.analyze(documentId);
      router.push(`/documents/${documentId}`);
    } catch (err) {
      setError((err as Error).message);
      setUploading(false);
    }
  };

  // One-click demo path: fetch the bundled sample contract and run it
  const trySample = async () => {
    setUploading(true);
    setError(null);
    try {
      const res = await fetch("/vendor-msa-risky.txt");
      if (!res.ok) throw new Error("Sample file unavailable");
      const blob = await res.blob();
      const file = new File([blob], "vendor-msa-risky.txt", { type: "text/plain" });
      const { documentId } = await api.uploadDocument(file);
      await api.analyze(documentId);
      router.push(`/documents/${documentId}`);
    } catch (err) {
      setError((err as Error).message);
      setUploading(false);
    }
  };

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="animate-rise pt-2">
        <h1 className="max-w-3xl font-serif text-[34px] font-semibold leading-[1.15] tracking-tight sm:text-[40px]">
          Contract review in minutes.
          <br />
          <span className="text-brand-strong">Verified by humans, gated by AI safety.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-dim">
          Five Mastra agents parse your contract, benchmark every clause against market standards
          in Qdrant, score the risk, and draft safer redlines — with Enkrypt AI checking every
          output and you approving every decision.
        </p>
        {health && (
          <div className="mt-5 flex flex-wrap gap-2" aria-label="Service status">
            <Chip tone={health.groqKey ? "pass" : "fail"}>
              Groq {health.groqKey ? "connected" : "key missing"}
            </Chip>
            <Chip tone={health.qdrant === "ok" ? "pass" : "warn"}>Qdrant {health.qdrant}</Chip>
            <Chip tone={health.enkryptKey ? "pass" : "warn"}>
              Enkrypt {health.enkryptKey ? "connected" : "local fallback"}
            </Chip>
            <Chip tone="neutral" title="Configured models">
              <IconZap size={10} />
              {health.models.reasoning.split("/").pop()} · {health.models.fast.split("/").pop()}
            </Chip>
          </div>
        )}
      </section>

      {/* Upload dropzone */}
      <section
        className={`animate-rise rounded-2xl border-2 border-dashed p-10 text-center transition-colors duration-200 ${
          dragOver ? "border-brand bg-brand/5" : "border-edge-strong/40 bg-surface/60"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        {uploading ? (
          <Spinner label="Uploading & starting the legalReviewWorkflow…" />
        ) : (
          <>
            <div className="mx-auto grid size-12 place-items-center rounded-xl border border-edge bg-raised text-brand-strong">
              <IconUpload size={20} />
            </div>
            <p className="mt-4 text-sm font-semibold">Drop a contract here — PDF, DOCX, or TXT</p>
            <p className="mt-1 text-xs text-ink-faint">
              Analysis starts automatically · 10MB max · ~40 clauses per document on the free tier
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <Button onClick={() => fileInput.current?.click()}>
                <IconFileText size={14} />
                Choose file
              </Button>
              <Button variant="ghost" onClick={trySample} ariaLabel="Analyze the sample contract">
                <IconZap size={14} />
                Try the sample contract
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,.docx,.txt,.md"
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
                aria-label="Upload contract file"
              />
            </div>
            <p className="mt-3 text-[11px] text-ink-faint">
              No contract handy? The sample is a deliberately one-sided vendor MSA —{" "}
              <a
                href="/vendor-msa-risky.txt"
                download
                className="font-medium text-brand underline-offset-2 hover:underline"
              >
                download it
              </a>{" "}
              or run it with one click.
            </p>
          </>
        )}
        {error && (
          <p className="mt-3 text-xs font-medium text-risk-high" role="alert">
            {error}
          </p>
        )}
      </section>

      {/* How it works strip */}
      <section className="animate-rise">
        <SectionTitle>The pipeline</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-5">
          {PIPELINE_STEPS.map((step, i) => (
            <div
              key={step.label}
              className="relative rounded-xl border border-edge bg-surface/70 p-3.5"
            >
              <div className="flex items-center gap-2 text-brand-strong">
                <step.icon size={15} />
                <span className="text-[10px] font-bold tabular-nums text-ink-faint">
                  0{i + 1}
                </span>
              </div>
              <p className="mt-2 text-[13px] font-semibold leading-tight">{step.label}</p>
              <p className="mt-1 text-[11px] leading-snug text-ink-faint">{step.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Documents */}
      <section className="animate-rise">
        <SectionTitle
          right={
            documents && documents.length > 0 ? (
              <span className="text-xs tabular-nums text-ink-faint">
                {documents.length} document{documents.length === 1 ? "" : "s"}
              </span>
            ) : undefined
          }
        >
          Documents
        </SectionTitle>
        {!documents ? (
          <SkeletonRows rows={2} height={84} />
        ) : documents.length === 0 ? (
          <EmptyState
            icon={<IconLayers size={26} />}
            title="No documents yet"
            hint="Click “Try the sample contract” above — a deliberately one-sided vendor MSA that lights up every risk detector."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {documents.map((doc) => (
              <Link key={doc.id} href={`/documents/${doc.id}`} className="group">
                <Card className="h-full p-4 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-brand/40 group-hover:shadow-lg group-hover:shadow-black/20">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-edge bg-raised text-ink-dim">
                        <IconFileText size={16} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold transition-colors duration-150 group-hover:text-brand-strong">
                          {doc.title ?? doc.filename}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-faint">{doc.filename}</p>
                      </div>
                    </div>
                    <StatusPill status={doc.status} />
                  </div>
                  <p className="mt-3 text-[11px] tabular-nums text-ink-faint">
                    Updated {new Date(doc.updatedAt).toLocaleString()}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
