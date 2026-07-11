/**
 * legalReviewWorkflow — the orchestrated ClauseGuard pipeline:
 *
 *   parseDocument → classifyClauses → indexClauses → analyzeRisk (G1)
 *     → riskReviewGate  [SUSPEND · HITL 1]
 *   → generateRedlines (G3)
 *     → finalApprovalGate [SUSPEND · HITL 2]
 *   → compileReport (G4)
 *
 * Design notes:
 *  - Steps thread only {documentId, correlationId}; heavy data lives in the DB
 *    so suspended runs survive server restarts and snapshots stay small.
 *  - Human decisions at both gates are written to review_feedback AND embedded
 *    into Qdrant review_memory — the learning loop that calibrates future runs.
 *  - Deterministic-first parsing: regex pre-segmentation handles structured
 *    contracts; the docParserAgent only takes over for unstructured text.
 *  - All LLM calls go through tracedGenerate (observability + 429 backoff).
 */
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { config } from "../../config";
import {
  clauses as clausesTable,
  db,
  documents as documentsTable,
  ensureSchema,
  logRunStep,
  now,
  reviewFeedback,
  runs as runsTable,
  uid,
} from "../../services/db";
import {
  gateG1RiskGrounding,
  gateG3RedlineSafety,
  gateG4FinalCompliance,
} from "../../services/enkrypt";
import { extractText, preSegment } from "../../services/parsing";
import {
  ensureCollections,
  indexDocumentClauses,
  recallReviewDecisions,
  rememberReviewDecision,
  searchBenchmarks,
  type BenchmarkHit,
} from "../../services/qdrant";
import { tracedGenerate } from "../../services/tracing";
import {
  clauseClassifierAgent,
  docParserAgent,
  legalQaAgent,
  redlineAgent,
  riskAnalysisAgent,
} from "../agents";
import {
  classifiedClausesSchema,
  parsedClausesSchema,
  redlineSchema,
  reportSchema,
  riskFindingsSchema,
} from "../schemas";

const stateSchema = z.object({
  documentId: z.string(),
  correlationId: z.string(),
});
type State = z.infer<typeof stateSchema>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Pause between consecutive Groq calls — keeps free-tier RPM/TPM happy. */
const LLM_PACING_MS = 1200;

async function setDocumentStatus(documentId: string, status: string, error?: string) {
  await ensureSchema();
  await db
    .update(documentsTable)
    .set({ status, errorMessage: error ?? null, updatedAt: now() })
    .where(eq(documentsTable.id, documentId));
}

async function getDocument(documentId: string) {
  await ensureSchema();
  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, documentId));
  if (!doc) throw new Error(`Document ${documentId} not found`);
  return doc;
}

async function getClauses(documentId: string) {
  await ensureSchema();
  const rows = await db
    .select()
    .from(clausesTable)
    .where(eq(clausesTable.documentId, documentId));
  return rows.sort((a, b) => a.ordinal - b.ordinal);
}

async function saveSuspendPayload(runId: string, status: string, payload: unknown) {
  await ensureSchema();
  await db
    .update(runsTable)
    .set({ status, suspendPayload: JSON.stringify(payload), updatedAt: now() })
    .where(eq(runsTable.runId, runId));
}

function benchmarkContext(benchmarks: BenchmarkHit[]): string {
  if (benchmarks.length === 0) return "(no benchmarks retrieved)";
  return benchmarks
    .map(
      (b, i) =>
        `[B${i + 1}] (${b.clauseType ?? "unknown"} · ${b.jurisdiction ?? "general"} · baseline risk: ${b.riskBaseline ?? "n/a"})\n"${b.text.slice(0, 500)}"${b.guidance ? `\nGuidance: ${b.guidance}` : ""}`,
    )
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Step 1 — parseDocument
// ---------------------------------------------------------------------------
const parseDocument = createStep({
  id: "parseDocument",
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData, runId }) => {
    const { documentId, correlationId } = inputData as State;
    const ctx = { correlationId, runId, documentId };
    await logRunStep(runId, "parseDocument", "started");
    await setDocumentStatus(documentId, "parsing");
    try {
      const doc = await getDocument(documentId);
      const text = await extractText(doc.storagePath, doc.mime);
      if (text.length < 100) throw new Error("Document contains too little text to analyze");

      // Deterministic cascade (headings → paragraphs → sentence windows).
      // Always yields segments, so parsing can never fail on LLM behavior.
      const segments = preSegment(text, config.limits.maxClauses);
      let clauses: Array<{ ordinal: number; heading: string | null; text: string }> = segments.map(
        (s) => ({ ordinal: s.ordinal, heading: s.heading, text: s.text }),
      );

      // Optional LLM refinement for unstructured docs (better clause
      // boundaries). Failure here silently falls back to the windows.
      const hasHeadings = segments.some((s) => s.heading);
      if (!hasHeadings && segments.length < 8) {
        try {
          const chunk = text.slice(0, 14000);
          const refined = await tracedGenerate(
            docParserAgent,
            "docParserAgent",
            `Segment this contract into clauses. Return JSON only.\n\nDOCUMENT:\n"""\n${chunk}\n"""`,
            parsedClausesSchema,
            ctx,
          );
          if (refined.clauses.length >= segments.length) {
            clauses = refined.clauses
              .slice(0, config.limits.maxClauses)
              .map((c, i) => ({ ordinal: i + 1, heading: c.heading ?? null, text: c.text }));
          }
        } catch (err) {
          await logRunStep(
            runId,
            "parseDocument",
            "started",
            `LLM segmentation unavailable (${String((err as Error).message).slice(0, 120)}) — using deterministic segments`,
          );
        }
      }

      // Title/type identification — best-effort, filename fallback.
      let documentTitle = doc.filename.replace(/\.[^.]+$/, "").replaceAll(/[_-]+/g, " ");
      try {
        const meta = await tracedGenerate(
          docParserAgent,
          "docParserAgent",
          `Identify this document. Return JSON only.\n\nDOCUMENT START:\n"""\n${text.slice(0, 2500)}\n"""\n\nReturn: {"documentTitle": string, "documentType": string, "clauses": [{"ordinal": 1, "heading": null, "text": "n/a"}]}`,
          parsedClausesSchema,
          ctx,
        );
        if (meta.documentTitle?.trim()) documentTitle = meta.documentTitle.trim();
      } catch {
        /* filename fallback stands */
      }

      const parsed = { documentTitle, clauses };

      // Replace any prior clauses (idempotent re-analysis)
      await db.delete(clausesTable).where(eq(clausesTable.documentId, documentId));
      for (const c of parsed.clauses) {
        await db.insert(clausesTable).values({
          id: uid(),
          documentId,
          ordinal: c.ordinal,
          heading: c.heading ?? null,
          text: c.text,
          redlineStatus: "none",
          createdAt: now(),
          updatedAt: now(),
        });
      }
      await db
        .update(documentsTable)
        .set({ title: parsed.documentTitle, updatedAt: now() })
        .where(eq(documentsTable.id, documentId));

      await logRunStep(runId, "parseDocument", "completed", `${parsed.clauses.length} clauses`);
      return { documentId, correlationId };
    } catch (err) {
      await logRunStep(runId, "parseDocument", "failed", (err as Error).message);
      await setDocumentStatus(documentId, "failed", (err as Error).message);
      throw err;
    }
  },
});

// ---------------------------------------------------------------------------
// Step 2 — classifyClauses
// ---------------------------------------------------------------------------
const classifyClauses = createStep({
  id: "classifyClauses",
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData, runId }) => {
    const { documentId, correlationId } = inputData as State;
    const ctx = { correlationId, runId, documentId };
    await logRunStep(runId, "classifyClauses", "started");
    await setDocumentStatus(documentId, "classifying");
    try {
      const clauseRows = await getClauses(documentId);
      const batchSize = config.limits.classifyBatchSize;
      for (let i = 0; i < clauseRows.length; i += batchSize) {
        const batch = clauseRows.slice(i, i + batchSize);
        const listing = batch
          .map(
            (c) =>
              `${c.ordinal}. ${c.heading ? `[${c.heading}] ` : ""}${c.text.slice(0, 900)}`,
          )
          .join("\n\n");
        try {
          const result = await tracedGenerate(
            clauseClassifierAgent,
            "clauseClassifierAgent",
            `Classify these clauses. Return JSON only.\n\nCLAUSES:\n${listing}`,
            classifiedClausesSchema,
            ctx,
          );
          for (const item of result.classifications) {
            const row = batch.find((c) => c.ordinal === item.ordinal);
            if (!row) continue;
            await db
              .update(clausesTable)
              .set({
                clauseType: item.clauseType,
                keyTerms: JSON.stringify(item.keyTerms ?? []),
                updatedAt: now(),
              })
              .where(eq(clausesTable.id, row.id));
          }
        } catch (err) {
          // Classification is an enhancement, not a dependency: unclassified
          // clauses fall back to "other" and the pipeline continues.
          await logRunStep(
            runId,
            "classifyClauses",
            "started",
            `batch ${i / batchSize + 1} degraded to "other" (${String((err as Error).message).slice(0, 100)})`,
          );
          for (const row of batch) {
            await db
              .update(clausesTable)
              .set({ clauseType: "other", keyTerms: "[]", updatedAt: now() })
              .where(eq(clausesTable.id, row.id));
          }
        }
        if (i + batchSize < clauseRows.length) await sleep(LLM_PACING_MS);
      }
      await logRunStep(runId, "classifyClauses", "completed");
      return { documentId, correlationId };
    } catch (err) {
      await logRunStep(runId, "classifyClauses", "failed", (err as Error).message);
      await setDocumentStatus(documentId, "failed", (err as Error).message);
      throw err;
    }
  },
});

// ---------------------------------------------------------------------------
// Step 3 — indexClauses (Qdrant, no LLM)
// ---------------------------------------------------------------------------
const indexClauses = createStep({
  id: "indexClauses",
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData, runId }) => {
    const { documentId, correlationId } = inputData as State;
    await logRunStep(runId, "indexClauses", "started");
    await setDocumentStatus(documentId, "indexing");
    try {
      await ensureCollections();
      const clauseRows = await getClauses(documentId);
      await indexDocumentClauses(
        documentId,
        clauseRows.map((c) => ({
          id: c.id,
          ordinal: c.ordinal,
          heading: c.heading,
          text: c.text,
          clauseType: c.clauseType,
        })),
      );
      await logRunStep(runId, "indexClauses", "completed", `${clauseRows.length} vectors`);
      return { documentId, correlationId };
    } catch (err) {
      await logRunStep(runId, "indexClauses", "failed", (err as Error).message);
      await setDocumentStatus(documentId, "failed", (err as Error).message);
      throw err;
    }
  },
});

// ---------------------------------------------------------------------------
// Step 4 — analyzeRisk (+ Enkrypt G1 per finding)
// ---------------------------------------------------------------------------
const analyzeRisk = createStep({
  id: "analyzeRisk",
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData, runId }) => {
    const { documentId, correlationId } = inputData as State;
    const ctx = { correlationId, runId, documentId };
    await logRunStep(runId, "analyzeRisk", "started");
    await setDocumentStatus(documentId, "analyzing_risk");
    try {
      const clauseRows = await getClauses(documentId);
      const batchSize = config.limits.riskBatchSize;

      for (let i = 0; i < clauseRows.length; i += batchSize) {
        const batch = clauseRows.slice(i, i + batchSize);

        // Retrieve benchmarks + review memory per clause (hybrid search)
        const enriched = await Promise.all(
          batch.map(async (c) => {
            const benchmarks = await searchBenchmarks(c.text.slice(0, 1000), {
              clauseType: c.clauseType ?? undefined,
              limit: 3,
            });
            const memory = await recallReviewDecisions(c.text, c.clauseType, 2);
            return { clause: c, benchmarks, memory };
          }),
        );

        const prompt = enriched
          .map(({ clause, benchmarks, memory }) => {
            const memoryBlock =
              memory.length > 0
                ? `\nPRIOR HUMAN DECISIONS on similar clauses:\n${memory
                    .map(
                      (m) =>
                        `- action=${m.action}${m.toValue && m.toValue !== "null" ? ` → ${m.toValue}` : ""}${m.note ? ` (reviewer note: "${m.note}")` : ""}`,
                    )
                    .join("\n")}`
                : "";
            return `CLAUSE ${clause.ordinal} (type: ${clause.clauseType ?? "unknown"}):\n"""${clause.text.slice(0, 1300)}"""\n\nMARKET BENCHMARKS:\n${benchmarkContext(benchmarks)}${memoryBlock}`;
          })
          .join("\n\n====\n\n");

        type Enriched = (typeof enriched)[number];
        type Finding = z.infer<typeof riskFindingsSchema>["findings"][number];

        // Persist one finding (runs the G1 grounding gate first).
        const persistFinding = async (entry: Enriched, finding: Finding) => {
          const g1 = await gateG1RiskGrounding(
            { documentId, runId, subjectType: "clause", subjectId: entry.clause.id },
            finding.rationale,
            entry.clause.text,
            benchmarkContext(entry.benchmarks),
          );
          await db
            .update(clausesTable)
            .set({
              riskLevel: finding.riskLevel,
              riskScore: finding.riskScore,
              riskRationale:
                g1.verdict === "warn"
                  ? `${finding.rationale}\n\n⚠ G1 grounding check: ${g1.reasons.join("; ")}`
                  : finding.rationale,
              benchmarkRefs: JSON.stringify(
                entry.benchmarks.map((b, bi) => ({
                  label: `B${bi + 1}`,
                  id: b.id,
                  clauseType: b.clauseType,
                  jurisdiction: b.jurisdiction,
                  riskBaseline: b.riskBaseline,
                  snippet: b.text.slice(0, 240),
                  source: b.source,
                })),
              ),
              updatedAt: now(),
            })
            .where(eq(clausesTable.id, entry.clause.id));
        };

        const persisted = new Set<number>();
        try {
          const expectedOrdinals = batch.map((c) => c.ordinal).join(", ");
          const result = await tracedGenerate(
            riskAnalysisAgent,
            "riskAnalysisAgent",
            `Analyze the risk of each clause below. Return JSON only with EXACTLY one finding per clause, using the EXACT ordinals shown (expected ordinals: ${expectedOrdinals} — never renumber).\n\n${prompt}`,
            riskFindingsSchema,
            ctx,
          );
          for (const finding of result.findings) {
            const entry = enriched.find((e) => e.clause.ordinal === finding.ordinal);
            if (!entry) continue;
            await persistFinding(entry, finding);
            persisted.add(finding.ordinal);
          }
        } catch (err) {
          await logRunStep(
            runId,
            "analyzeRisk",
            "started",
            `batch failed (${String((err as Error).message).slice(0, 100)}) — falling back to per-clause analysis`,
          );
        }

        // Skipped, renumbered, or batch-failed clauses → analyze individually.
        // A clause that still fails is left unscored for the human gate rather
        // than failing the whole workflow.
        for (const entry of enriched.filter((e) => !persisted.has(e.clause.ordinal))) {
          await sleep(LLM_PACING_MS);
          try {
            const single = await tracedGenerate(
              riskAnalysisAgent,
              "riskAnalysisAgent:single",
              `Analyze the risk of this single clause. Return JSON only with exactly one finding with ordinal ${entry.clause.ordinal}.\n\nCLAUSE ${entry.clause.ordinal} (type: ${entry.clause.clauseType ?? "unknown"}):\n"""${entry.clause.text.slice(0, 1300)}"""\n\nMARKET BENCHMARKS:\n${benchmarkContext(entry.benchmarks)}`,
              riskFindingsSchema,
              ctx,
            );
            const finding = single.findings[0];
            if (finding) {
              await persistFinding(entry, { ...finding, ordinal: entry.clause.ordinal });
              persisted.add(entry.clause.ordinal);
            }
          } catch (err) {
            await logRunStep(
              runId,
              "analyzeRisk",
              "started",
              `clause ${entry.clause.ordinal} left unscored (${String((err as Error).message).slice(0, 100)})`,
            );
          }
        }
        if (i + batchSize < clauseRows.length) await sleep(LLM_PACING_MS);
      }

      await logRunStep(runId, "analyzeRisk", "completed");
      return { documentId, correlationId };
    } catch (err) {
      await logRunStep(runId, "analyzeRisk", "failed", (err as Error).message);
      await setDocumentStatus(documentId, "failed", (err as Error).message);
      throw err;
    }
  },
});

// ---------------------------------------------------------------------------
// Step 5 — riskReviewGate [SUSPEND · HITL Gate 1]
// ---------------------------------------------------------------------------
const riskReviewResumeSchema = z.object({
  approved: z.boolean(),
  overrides: z
    .array(
      z.object({
        ordinal: z.number().int(),
        riskLevel: z.enum(["low", "medium", "high"]).optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  reviewerNotes: z.string().optional(),
});

const riskReviewGate = createStep({
  id: "riskReviewGate",
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  suspendSchema: z.object({
    gate: z.literal("risk_review"),
    summary: z.object({
      total: z.number(),
      high: z.number(),
      medium: z.number(),
      low: z.number(),
    }),
  }),
  resumeSchema: riskReviewResumeSchema,
  execute: async ({ inputData, resumeData, suspend, runId }) => {
    const { documentId, correlationId } = inputData as State;

    if (!resumeData) {
      const clauseRows = await getClauses(documentId);
      const summary = {
        total: clauseRows.length,
        high: clauseRows.filter((c) => c.riskLevel === "high").length,
        medium: clauseRows.filter((c) => c.riskLevel === "medium").length,
        low: clauseRows.filter((c) => c.riskLevel === "low").length,
      };
      await setDocumentStatus(documentId, "awaiting_risk_review");
      await saveSuspendPayload(runId, "suspended_risk_review", { gate: "risk_review", summary });
      await logRunStep(runId, "riskReviewGate", "suspended", "awaiting human risk review");
      return await suspend({ gate: "risk_review" as const, summary });
    }

    // --- Resumed: apply human decisions -----------------------------------
    const decisions = riskReviewResumeSchema.parse(resumeData);
    if (!decisions.approved) {
      await setDocumentStatus(documentId, "failed", "Risk analysis rejected by reviewer");
      await logRunStep(runId, "riskReviewGate", "failed", "reviewer rejected the analysis");
      throw new Error("Risk analysis rejected by human reviewer");
    }

    const clauseRows = await getClauses(documentId);
    for (const override of decisions.overrides) {
      const row = clauseRows.find((c) => c.ordinal === override.ordinal);
      if (!row || !override.riskLevel || override.riskLevel === row.riskLevel) continue;

      await db
        .update(clausesTable)
        .set({
          riskLevel: override.riskLevel,
          humanOverride: JSON.stringify({
            field: "riskLevel",
            from: row.riskLevel,
            to: override.riskLevel,
            note: override.note ?? null,
          }),
          updatedAt: now(),
        })
        .where(eq(clausesTable.id, row.id));

      await db.insert(reviewFeedback).values({
        id: uid(),
        documentId,
        clauseId: row.id,
        gate: "risk_review",
        action: "overridden",
        fromValue: JSON.stringify({ riskLevel: row.riskLevel }),
        toValue: JSON.stringify({ riskLevel: override.riskLevel }),
        note: override.note ?? null,
        createdAt: now(),
      });

      // Learning loop → Qdrant review_memory
      await rememberReviewDecision({
        id: uid(),
        documentId,
        clauseType: row.clauseType,
        clauseText: row.text,
        action: "risk_overridden",
        fromValue: { riskLevel: row.riskLevel },
        toValue: { riskLevel: override.riskLevel },
        note: override.note,
      });
    }

    await db.insert(reviewFeedback).values({
      id: uid(),
      documentId,
      clauseId: null,
      gate: "risk_review",
      action: "approved",
      fromValue: null,
      toValue: JSON.stringify({ overrides: decisions.overrides.length }),
      note: decisions.reviewerNotes ?? null,
      createdAt: now(),
    });

    await logRunStep(
      runId,
      "riskReviewGate",
      "completed",
      `approved with ${decisions.overrides.length} override(s)`,
    );
    return { documentId, correlationId };
  },
});

// ---------------------------------------------------------------------------
// Step 6 — generateRedlines (+ Enkrypt G3 per redline)
// ---------------------------------------------------------------------------
const generateRedlines = createStep({
  id: "generateRedlines",
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  execute: async ({ inputData, runId }) => {
    const { documentId, correlationId } = inputData as State;
    const ctx = { correlationId, runId, documentId };
    await logRunStep(runId, "generateRedlines", "started");
    await setDocumentStatus(documentId, "generating_redlines");
    try {
      const clauseRows = await getClauses(documentId);
      const risky = clauseRows.filter(
        (c) => c.riskLevel === "high" || c.riskLevel === "medium",
      );

      for (const clause of risky) {
        const benchmarks: BenchmarkHit[] = JSON.parse(clause.benchmarkRefs ?? "[]").map(
          (b: Record<string, unknown>) => ({
            id: String(b.id),
            score: 0,
            text: String(b.snippet ?? ""),
            clauseType: b.clauseType as string,
            jurisdiction: b.jurisdiction as string,
            riskBaseline: b.riskBaseline as string,
            source: b.source as string,
          }),
        );

        let result;
        try {
          result = await tracedGenerate(
            redlineAgent,
            "redlineAgent",
            `Draft a safer replacement for this clause. Return JSON only.\n\nORIGINAL CLAUSE ${clause.ordinal} (${clause.clauseType ?? "unknown"}):\n"""${clause.text.slice(0, 2200)}"""\n\nRISK ANALYSIS (${clause.riskLevel}, score ${clause.riskScore}):\n${clause.riskRationale ?? "n/a"}\n\nMARKET BENCHMARKS:\n${benchmarkContext(benchmarks)}`,
            redlineSchema,
            ctx,
          );
        } catch (err) {
          // One clause failing to redline never blocks the rest of the review.
          await logRunStep(
            runId,
            "generateRedlines",
            "started",
            `clause ${clause.ordinal}: redline skipped (${String((err as Error).message).slice(0, 100)})`,
          );
          continue;
        }

        // G3 — safety gate on the generated redline (audited)
        const g3 = await gateG3RedlineSafety(
          { documentId, runId, subjectType: "redline", subjectId: clause.id },
          result.redlineText,
          clause.text,
        );

        if (g3.verdict === "fail") {
          // Blocked redline never reaches the reviewer — recorded for audit.
          await db
            .update(clausesTable)
            .set({
              redlineStatus: "rejected",
              redlineRationale: `Blocked by Enkrypt G3: ${g3.reasons.join("; ")}`,
              updatedAt: now(),
            })
            .where(eq(clausesTable.id, clause.id));
        } else {
          await db
            .update(clausesTable)
            .set({
              redlineText: result.redlineText,
              redlineRationale: result.rationale,
              redlineStatus: "proposed",
              updatedAt: now(),
            })
            .where(eq(clausesTable.id, clause.id));
        }
        await sleep(LLM_PACING_MS);
      }

      await logRunStep(runId, "generateRedlines", "completed", `${risky.length} redline(s)`);
      return { documentId, correlationId };
    } catch (err) {
      await logRunStep(runId, "generateRedlines", "failed", (err as Error).message);
      await setDocumentStatus(documentId, "failed", (err as Error).message);
      throw err;
    }
  },
});

// ---------------------------------------------------------------------------
// Step 7 — finalApprovalGate [SUSPEND · HITL Gate 2]
// ---------------------------------------------------------------------------
const finalApprovalResumeSchema = z.object({
  approved: z.boolean(),
  decisions: z
    .array(
      z.object({
        ordinal: z.number().int(),
        action: z.enum(["approve", "edit", "reject"]),
        editedText: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  reviewerNotes: z.string().optional(),
});

const finalApprovalGate = createStep({
  id: "finalApprovalGate",
  inputSchema: stateSchema,
  outputSchema: stateSchema,
  suspendSchema: z.object({
    gate: z.literal("final_approval"),
    redlines: z.number(),
  }),
  resumeSchema: finalApprovalResumeSchema,
  execute: async ({ inputData, resumeData, suspend, runId }) => {
    const { documentId, correlationId } = inputData as State;

    if (!resumeData) {
      const clauseRows = await getClauses(documentId);
      const proposed = clauseRows.filter((c) => c.redlineStatus === "proposed").length;
      await setDocumentStatus(documentId, "awaiting_final_approval");
      await saveSuspendPayload(runId, "suspended_final_approval", {
        gate: "final_approval",
        redlines: proposed,
      });
      await logRunStep(runId, "finalApprovalGate", "suspended", "awaiting final approval");
      return await suspend({ gate: "final_approval" as const, redlines: proposed });
    }

    const decisions = finalApprovalResumeSchema.parse(resumeData);
    if (!decisions.approved) {
      await setDocumentStatus(documentId, "failed", "Final report rejected by reviewer");
      await logRunStep(runId, "finalApprovalGate", "failed", "reviewer rejected");
      throw new Error("Final approval rejected by human reviewer");
    }

    const clauseRows = await getClauses(documentId);
    for (const decision of decisions.decisions) {
      const row = clauseRows.find((c) => c.ordinal === decision.ordinal);
      if (!row || row.redlineStatus !== "proposed") continue;

      const newStatus =
        decision.action === "approve"
          ? "approved"
          : decision.action === "edit"
            ? "edited"
            : "rejected";

      await db
        .update(clausesTable)
        .set({
          redlineStatus: newStatus,
          redlineText:
            decision.action === "edit" && decision.editedText
              ? decision.editedText
              : row.redlineText,
          updatedAt: now(),
        })
        .where(eq(clausesTable.id, row.id));

      await db.insert(reviewFeedback).values({
        id: uid(),
        documentId,
        clauseId: row.id,
        gate: "final_approval",
        action: newStatus,
        fromValue: JSON.stringify({ redline: (row.redlineText ?? "").slice(0, 400) }),
        toValue:
          decision.action === "edit"
            ? JSON.stringify({ redline: (decision.editedText ?? "").slice(0, 400) })
            : null,
        note: decision.note ?? null,
        createdAt: now(),
      });

      // Learning loop: how humans treat proposed language
      await rememberReviewDecision({
        id: uid(),
        documentId,
        clauseType: row.clauseType,
        clauseText: row.text,
        action: `redline_${newStatus}`,
        fromValue: { redline: (row.redlineText ?? "").slice(0, 300) },
        toValue:
          decision.action === "edit"
            ? { redline: (decision.editedText ?? "").slice(0, 300) }
            : undefined,
        note: decision.note,
      });
    }

    await logRunStep(
      runId,
      "finalApprovalGate",
      "completed",
      `approved (${decisions.decisions.length} decision(s))`,
    );
    return { documentId, correlationId };
  },
});

// ---------------------------------------------------------------------------
// Step 8 — compileReport (+ Enkrypt G4)
// ---------------------------------------------------------------------------
const compileReport = createStep({
  id: "compileReport",
  inputSchema: stateSchema,
  outputSchema: z.object({
    documentId: z.string(),
    correlationId: z.string(),
    overallRisk: z.string(),
  }),
  execute: async ({ inputData, runId }) => {
    const { documentId, correlationId } = inputData as State;
    const ctx = { correlationId, runId, documentId };
    await logRunStep(runId, "compileReport", "started");
    await setDocumentStatus(documentId, "compiling_report");
    try {
      const doc = await getDocument(documentId);
      const clauseRows = await getClauses(documentId);
      const high = clauseRows.filter((c) => c.riskLevel === "high");
      const medium = clauseRows.filter((c) => c.riskLevel === "medium");

      const findingsDigest = [...high, ...medium]
        .slice(0, 12)
        .map(
          (c) =>
            `Clause ${c.ordinal} (${c.clauseType}, ${c.riskLevel}${c.humanOverride ? ", human-adjusted" : ""}): ${(c.riskRationale ?? "").slice(0, 260)}`,
        )
        .join("\n");

      let report;
      try {
        report = await tracedGenerate(
          riskAnalysisAgent,
          "riskAnalysisAgent:report",
          `Write the final review report summary for this contract. Return JSON only.\n\nDOCUMENT: ${doc.title ?? doc.filename}\nCLAUSES: ${clauseRows.length} total — ${high.length} high risk, ${medium.length} medium, ${clauseRows.filter((c) => c.riskLevel === "low").length} low.\n\nKEY FINDINGS (human-reviewed):\n${findingsDigest || "No elevated risks found."}`,
          reportSchema,
          ctx,
        );
      } catch (err) {
        // Deterministic fallback report — the review still completes with
        // human-verified findings even if the summarizer model is down.
        await logRunStep(
          runId,
          "compileReport",
          "started",
          `LLM summary unavailable (${String((err as Error).message).slice(0, 100)}) — deterministic report`,
        );
        const topClauses = [...high, ...medium].slice(0, 5);
        report = {
          executiveSummary:
            `Human-verified review of ${doc.title ?? doc.filename}: ${clauseRows.length} clauses analyzed — ` +
            `${high.length} high risk, ${medium.length} medium risk. ` +
            (topClauses.length > 0
              ? `Primary concerns: ${topClauses.map((c) => `clause ${c.ordinal} (${(c.clauseType ?? "unclassified").replaceAll("_", " ")})`).join(", ")}.`
              : "No elevated risks were identified."),
          overallRisk: (high.length > 0 ? "high" : medium.length > 0 ? "medium" : "low") as
            | "high"
            | "medium"
            | "low",
          topConcerns: topClauses.map(
            (c) => `Clause ${c.ordinal} (${(c.clauseType ?? "unclassified").replaceAll("_", " ")}): ${(c.riskRationale ?? "").slice(0, 140)}`,
          ),
          recommendations: [
            "Review each high-risk clause with counsel before signing.",
            "Use the approved redlines as the negotiation baseline.",
          ],
        };
      }

      // G4 — final compliance gate (disclaimer enforced deterministically)
      const g4 = await gateG4FinalCompliance(
        { documentId, runId, subjectType: "report", subjectId: documentId },
        report.executiveSummary,
      );

      const finalReport = {
        ...report,
        executiveSummary: g4.compliantText,
        stats: {
          totalClauses: clauseRows.length,
          high: high.length,
          medium: medium.length,
          low: clauseRows.filter((c) => c.riskLevel === "low").length,
          redlinesApproved: clauseRows.filter(
            (c) => c.redlineStatus === "approved" || c.redlineStatus === "edited",
          ).length,
          humanOverrides: clauseRows.filter((c) => c.humanOverride).length,
        },
        completedAt: now(),
      };

      await db
        .update(documentsTable)
        .set({ reportJson: JSON.stringify(finalReport), status: "completed", updatedAt: now() })
        .where(eq(documentsTable.id, documentId));
      await db
        .update(runsTable)
        .set({ status: "completed", suspendPayload: null, updatedAt: now() })
        .where(eq(runsTable.runId, runId));

      await logRunStep(runId, "compileReport", "completed", `overall ${report.overallRisk}`);
      return { documentId, correlationId, overallRisk: report.overallRisk };
    } catch (err) {
      await logRunStep(runId, "compileReport", "failed", (err as Error).message);
      await setDocumentStatus(documentId, "failed", (err as Error).message);
      throw err;
    }
  },
});

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------
export const legalReviewWorkflow = createWorkflow({
  id: "legalReviewWorkflow",
  inputSchema: stateSchema,
  outputSchema: z.object({
    documentId: z.string(),
    correlationId: z.string(),
    overallRisk: z.string(),
  }),
})
  .then(parseDocument)
  .then(classifyClauses)
  .then(indexClauses)
  .then(analyzeRisk)
  .then(riskReviewGate)
  .then(generateRedlines)
  .then(finalApprovalGate)
  .then(compileReport)
  .commit();

export { legalQaAgent };
