/**
 * Custom API routes on the Mastra server (Hono). All routes sit behind
 * securityMiddleware (auth + rate limit + correlation IDs) registered in
 * src/mastra/index.ts, and validate inputs with Zod before touching state.
 */
import { registerApiRoute } from "@mastra/core/server";
import { desc, eq } from "drizzle-orm";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config, modelLabel } from "../config";
import {
  clauses as clausesTable,
  db,
  documents as documentsTable,
  enkryptVerdicts,
  ensureSchema,
  llmTraces,
  now,
  qaMessages,
  reviewFeedback,
  runs as runsTable,
  uid,
} from "../services/db";
import { gateG2QaGrounding, scanUserInput } from "../services/enkrypt";
import { collectionStats, searchDocumentClauses } from "../services/qdrant";
import { getCorrelationId } from "../services/security";
import { tracedGenerate } from "../services/tracing";
import { legalQaAgent } from "../mastra/agents";
import { qaAnswerSchema } from "../mastra/schemas";

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);

const analyzeBodySchema = z.object({}).passthrough();

const approveBodySchema = z.object({
  gate: z.enum(["risk_review", "final_approval"]),
  approved: z.boolean(),
  overrides: z
    .array(
      z.object({
        ordinal: z.number().int(),
        riskLevel: z.enum(["low", "medium", "high"]).optional(),
        note: z.string().max(2000).optional(),
      }),
    )
    .optional(),
  decisions: z
    .array(
      z.object({
        ordinal: z.number().int(),
        action: z.enum(["approve", "edit", "reject"]),
        editedText: z.string().max(20000).optional(),
        note: z.string().max(2000).optional(),
      }),
    )
    .optional(),
  reviewerNotes: z.string().max(4000).optional(),
});

const qaBodySchema = z.object({
  question: z.string().min(3).max(2000),
});

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serializeClause(c: typeof clausesTable.$inferSelect) {
  return {
    id: c.id,
    ordinal: c.ordinal,
    heading: c.heading,
    text: c.text,
    clauseType: c.clauseType,
    keyTerms: parseJson<string[]>(c.keyTerms, []),
    riskLevel: c.riskLevel,
    riskScore: c.riskScore,
    riskRationale: c.riskRationale,
    benchmarkRefs: parseJson<unknown[]>(c.benchmarkRefs, []),
    redlineText: c.redlineText,
    redlineRationale: c.redlineRationale,
    redlineStatus: c.redlineStatus,
    humanOverride: parseJson<unknown>(c.humanOverride, null),
  };
}

export const apiRoutes = [
  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------
  registerApiRoute("/v1/health", {
    method: "GET",
    handler: async (c) => {
      await ensureSchema();
      let qdrantStatus = "unreachable";
      try {
        const { qdrant } = await import("../services/qdrant");
        await qdrant().getCollections();
        qdrantStatus = "ok";
      } catch {
        /* stays unreachable */
      }
      return c.json({
        status: "ok",
        groqKey: Boolean(process.env.GROQ_API_KEY),
        enkryptKey: Boolean(config.enkrypt.apiKey),
        qdrant: qdrantStatus,
        models: {
          reasoning: modelLabel(config.reasoningModel),
          fast: modelLabel(config.fastModel),
        },
      });
    },
  }),

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------
  registerApiRoute("/v1/documents", {
    method: "POST",
    handler: async (c) => {
      await ensureSchema();
      const correlationId = getCorrelationId(c);
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File)) {
        return c.json({ error: "multipart field 'file' is required" }, 400);
      }
      if (file.size > config.limits.maxUploadBytes) {
        return c.json({ error: `File exceeds ${config.limits.maxUploadBytes / 1024 / 1024}MB limit` }, 413);
      }
      const mime = file.type || "text/plain";
      const ext = path.extname(file.name).toLowerCase();
      if (!ALLOWED_MIMES.has(mime) && ![".pdf", ".docx", ".txt", ".md"].includes(ext)) {
        return c.json({ error: `Unsupported file type: ${mime || ext}` }, 415);
      }

      const id = uid();
      await mkdir(config.uploadDir, { recursive: true });
      const storagePath = path.join(config.uploadDir, `${id}${ext || ".txt"}`);
      await writeFile(storagePath, Buffer.from(await file.arrayBuffer()));

      await db.insert(documentsTable).values({
        id,
        filename: file.name,
        mime,
        storagePath,
        status: "uploaded",
        correlationId,
        createdAt: now(),
        updatedAt: now(),
      });
      return c.json({ documentId: id, filename: file.name, status: "uploaded", correlationId }, 201);
    },
  }),

  registerApiRoute("/v1/documents", {
    method: "GET",
    handler: async (c) => {
      await ensureSchema();
      const docs = await db
        .select()
        .from(documentsTable)
        .orderBy(desc(documentsTable.createdAt))
        .limit(50);
      return c.json({
        documents: docs.map((d) => ({
          id: d.id,
          filename: d.filename,
          title: d.title,
          status: d.status,
          workflowRunId: d.workflowRunId,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        })),
      });
    },
  }),

  registerApiRoute("/v1/documents/:id", {
    method: "GET",
    handler: async (c) => {
      await ensureSchema();
      const id = c.req.param("id");
      const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
      if (!doc) return c.json({ error: "Document not found" }, 404);
      const clauseRows = await db
        .select()
        .from(clausesTable)
        .where(eq(clausesTable.documentId, id));
      clauseRows.sort((a, b) => a.ordinal - b.ordinal);
      return c.json({
        document: {
          id: doc.id,
          filename: doc.filename,
          title: doc.title,
          status: doc.status,
          workflowRunId: doc.workflowRunId,
          report: parseJson<unknown>(doc.reportJson, null),
          errorMessage: doc.errorMessage,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        },
        clauses: clauseRows.map(serializeClause),
      });
    },
  }),

  // -------------------------------------------------------------------------
  // Analyze — start the legalReviewWorkflow
  // -------------------------------------------------------------------------
  registerApiRoute("/v1/documents/:id/analyze", {
    method: "POST",
    handler: async (c) => {
      await ensureSchema();
      const documentId = c.req.param("id");
      const correlationId = getCorrelationId(c);
      analyzeBodySchema.parse(await c.req.json().catch(() => ({})));

      const [doc] = await db
        .select()
        .from(documentsTable)
        .where(eq(documentsTable.id, documentId));
      if (!doc) return c.json({ error: "Document not found" }, 404);

      // A run counts as active only if it's suspended (waiting on a human) or
      // recently heartbeating. "running" rows with no update for 10+ minutes
      // are orphans (server restart mid-run) — mark failed and allow retry.
      const STALE_MS = 10 * 60 * 1000;
      const active = await db
        .select()
        .from(runsTable)
        .where(eq(runsTable.documentId, documentId));
      for (const r of active) {
        const isRunning = r.status === "running";
        const fresh = Date.now() - new Date(r.updatedAt).getTime() < STALE_MS;
        if (r.status.startsWith("suspended") || (isRunning && fresh)) {
          return c.json({ error: "An analysis is already in progress for this document" }, 409);
        }
        if (isRunning && !fresh) {
          await db
            .update(runsTable)
            .set({ status: "failed", updatedAt: now() })
            .where(eq(runsTable.runId, r.runId));
        }
      }

      const mastra = c.get("mastra");
      const workflow = mastra.getWorkflow("legalReviewWorkflow");
      const run = await workflow.createRun();

      await db.insert(runsTable).values({
        runId: run.runId,
        documentId,
        workflowId: "legalReviewWorkflow",
        status: "running",
        stepLog: "[]",
        correlationId,
        createdAt: now(),
        updatedAt: now(),
      });
      await db
        .update(documentsTable)
        .set({ workflowRunId: run.runId, status: "queued", updatedAt: now() })
        .where(eq(documentsTable.id, documentId));

      // Fire and forget — progress is streamed via /api/runs/:id/stream.
      void run
        .start({ inputData: { documentId, correlationId } })
        .then(async (result) => {
          if (result.status === "failed") {
            await db
              .update(runsTable)
              .set({ status: "failed", updatedAt: now() })
              .where(eq(runsTable.runId, run.runId));
          }
        })
        .catch(async (err) => {
          console.error(`[workflow] run ${run.runId} crashed:`, err);
          await db
            .update(runsTable)
            .set({ status: "failed", updatedAt: now() })
            .where(eq(runsTable.runId, run.runId));
          await db
            .update(documentsTable)
            .set({ status: "failed", errorMessage: String((err as Error).message).slice(0, 500), updatedAt: now() })
            .where(eq(documentsTable.id, documentId));
        });

      return c.json({ runId: run.runId, documentId, correlationId, status: "running" }, 202);
    },
  }),

  // -------------------------------------------------------------------------
  // Run status + SSE stream
  // -------------------------------------------------------------------------
  registerApiRoute("/v1/runs/:id", {
    method: "GET",
    handler: async (c) => {
      await ensureSchema();
      const runId = c.req.param("id");
      const [run] = await db.select().from(runsTable).where(eq(runsTable.runId, runId));
      if (!run) return c.json({ error: "Run not found" }, 404);
      return c.json({
        runId: run.runId,
        documentId: run.documentId,
        status: run.status,
        currentStep: run.currentStep,
        stepLog: parseJson<unknown[]>(run.stepLog, []),
        suspendPayload: parseJson<unknown>(run.suspendPayload, null),
        correlationId: run.correlationId,
        updatedAt: run.updatedAt,
      });
    },
  }),

  registerApiRoute("/v1/runs/:id/stream", {
    method: "GET",
    handler: async (c) => {
      await ensureSchema();
      const runId = c.req.param("id");
      const signal = c.req.raw.signal;

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          let lastPayload = "";
          let closed = false;

          const close = (interval: ReturnType<typeof setInterval>) => {
            if (closed) return;
            closed = true;
            clearInterval(interval);
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          };

          const interval = setInterval(async () => {
            try {
              const [run] = await db.select().from(runsTable).where(eq(runsTable.runId, runId));
              if (!run) {
                controller.enqueue(encoder.encode(`event: error\ndata: {"error":"run not found"}\n\n`));
                close(interval);
                return;
              }
              const payload = JSON.stringify({
                runId: run.runId,
                documentId: run.documentId,
                status: run.status,
                currentStep: run.currentStep,
                stepLog: parseJson<unknown[]>(run.stepLog, []),
                suspendPayload: parseJson<unknown>(run.suspendPayload, null),
                updatedAt: run.updatedAt,
              });
              if (payload !== lastPayload) {
                lastPayload = payload;
                controller.enqueue(encoder.encode(`event: run\ndata: ${payload}\n\n`));
              }
              if (run.status === "completed" || run.status === "failed") {
                controller.enqueue(encoder.encode(`event: done\ndata: ${payload}\n\n`));
                close(interval);
              }
            } catch (err) {
              controller.enqueue(
                encoder.encode(`event: error\ndata: {"error":"${String((err as Error).message)}"}\n\n`),
              );
              close(interval);
            }
          }, 1200);

          signal?.addEventListener("abort", () => close(interval));
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    },
  }),

  // -------------------------------------------------------------------------
  // HITL — resume a suspended run
  // -------------------------------------------------------------------------
  registerApiRoute("/v1/runs/:id/approve", {
    method: "POST",
    handler: async (c) => {
      await ensureSchema();
      const runId = c.req.param("id");
      const parsedBody = approveBodySchema.safeParse(await c.req.json().catch(() => null));
      if (!parsedBody.success) {
        return c.json({ error: "Invalid body", details: parsedBody.error.flatten() }, 400);
      }
      const body = parsedBody.data;

      const [run] = await db.select().from(runsTable).where(eq(runsTable.runId, runId));
      if (!run) return c.json({ error: "Run not found" }, 404);

      const expectedStatus =
        body.gate === "risk_review" ? "suspended_risk_review" : "suspended_final_approval";
      if (run.status !== expectedStatus) {
        return c.json(
          { error: `Run is not suspended at ${body.gate} (current: ${run.status})` },
          409,
        );
      }

      const stepId = body.gate === "risk_review" ? "riskReviewGate" : "finalApprovalGate";
      const resumeData =
        body.gate === "risk_review"
          ? {
              approved: body.approved,
              overrides: body.overrides ?? [],
              reviewerNotes: body.reviewerNotes,
            }
          : {
              approved: body.approved,
              decisions: body.decisions ?? [],
              reviewerNotes: body.reviewerNotes,
            };

      const mastra = c.get("mastra");
      const workflow = mastra.getWorkflow("legalReviewWorkflow");
      const rehydrated = await workflow.createRun({ runId });

      await db
        .update(runsTable)
        .set({ status: "running", suspendPayload: null, updatedAt: now() })
        .where(eq(runsTable.runId, runId));

      // Fire and forget — the workflow continues (and may suspend again at gate 2).
      void rehydrated
        .resume({ step: stepId, resumeData })
        .then(async (result) => {
          if (result.status === "failed") {
            await db
              .update(runsTable)
              .set({ status: "failed", updatedAt: now() })
              .where(eq(runsTable.runId, runId));
          }
        })
        .catch(async (err) => {
          console.error(`[workflow] resume ${runId} crashed:`, err);
          await db
            .update(runsTable)
            .set({ status: "failed", updatedAt: now() })
            .where(eq(runsTable.runId, runId));
        });

      return c.json({ runId, resumed: true, gate: body.gate }, 202);
    },
  }),

  // -------------------------------------------------------------------------
  // Grounded Q&A (legalQaAgent + Enkrypt G2)
  // -------------------------------------------------------------------------
  registerApiRoute("/v1/documents/:id/qa", {
    method: "POST",
    handler: async (c) => {
      await ensureSchema();
      const documentId = c.req.param("id");
      const correlationId = getCorrelationId(c);
      const parsedBody = qaBodySchema.safeParse(await c.req.json().catch(() => null));
      if (!parsedBody.success) {
        return c.json({ error: "Invalid body: question (3-2000 chars) required" }, 400);
      }
      const { question } = parsedBody.data;

      const [doc] = await db
        .select()
        .from(documentsTable)
        .where(eq(documentsTable.id, documentId));
      if (!doc) return c.json({ error: "Document not found" }, 404);

      // Pre-flight: prompt-injection / abuse scan on the user input
      const inputScan = await scanUserInput(
        { documentId, subjectType: "qa", subjectId: undefined },
        question,
      );
      if (inputScan.verdict === "fail") {
        return c.json(
          { blocked: true, reasons: inputScan.reasons, verdictId: inputScan.verdictId },
          400,
        );
      }

      await db.insert(qaMessages).values({
        id: uid(),
        documentId,
        role: "user",
        content: question,
        createdAt: now(),
      });

      // Retrieve grounding context (hybrid search over this document only)
      const hits = await searchDocumentClauses(documentId, question, 5);
      const contextBlock = hits
        .map((h) => `[clause:${h.ordinal}]${h.heading ? ` ${h.heading}` : ""}\n"${h.text.slice(0, 900)}"`)
        .join("\n\n");

      const result = await tracedGenerate(
        legalQaAgent,
        "legalQaAgent",
        `Answer the question using ONLY these retrieved clauses. Return JSON only.\n\nRETRIEVED CLAUSES:\n${contextBlock || "(nothing retrieved)"}\n\nQUESTION: ${question}`,
        qaAnswerSchema,
        { correlationId, documentId },
      );

      // G2 — grounding gate (adherence + relevancy + citation verification)
      const g2 = await gateG2QaGrounding(
        { documentId, subjectType: "qa" },
        question,
        result.answer,
        contextBlock,
        hits.map((h) => h.ordinal),
      );

      const blocked = g2.verdict === "fail" && !result.notFound;
      const finalAnswer = blocked
        ? "I can't provide that answer — it failed the grounding check against the document. Please rephrase, or review the cited clauses directly."
        : result.answer;

      const assistantMessageId = uid();
      await db.insert(qaMessages).values({
        id: assistantMessageId,
        documentId,
        role: "assistant",
        content: finalAnswer,
        citations: JSON.stringify(result.citations ?? []),
        verdictId: g2.verdictId,
        createdAt: now(),
      });

      return c.json({
        messageId: assistantMessageId,
        answer: finalAnswer,
        citations: blocked ? [] : result.citations,
        confidence: result.confidence,
        notFound: result.notFound,
        blocked,
        gate: {
          verdict: g2.verdict,
          scores: g2.scores,
          reasons: g2.reasons,
          verdictId: g2.verdictId,
        },
        correlationId,
      });
    },
  }),

  registerApiRoute("/v1/documents/:id/qa", {
    method: "GET",
    handler: async (c) => {
      await ensureSchema();
      const documentId = c.req.param("id");
      const messages = await db
        .select()
        .from(qaMessages)
        .where(eq(qaMessages.documentId, documentId));
      messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return c.json({
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citations: parseJson<unknown[]>(m.citations, []),
          verdictId: m.verdictId,
          createdAt: m.createdAt,
        })),
      });
    },
  }),

  // -------------------------------------------------------------------------
  // Audit trail — Enkrypt verdicts + human feedback
  // -------------------------------------------------------------------------
  registerApiRoute("/v1/documents/:id/audit", {
    method: "GET",
    handler: async (c) => {
      await ensureSchema();
      const documentId = c.req.param("id");
      const verdicts = await db
        .select()
        .from(enkryptVerdicts)
        .where(eq(enkryptVerdicts.documentId, documentId));
      verdicts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const feedback = await db
        .select()
        .from(reviewFeedback)
        .where(eq(reviewFeedback.documentId, documentId));
      feedback.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return c.json({
        verdicts: verdicts.map((v) => ({
          id: v.id,
          gate: v.gate,
          subjectType: v.subjectType,
          subjectId: v.subjectId,
          verdict: v.verdict,
          scores: parseJson<unknown>(v.scores, {}),
          latencyMs: v.latencyMs,
          createdAt: v.createdAt,
        })),
        humanFeedback: feedback.map((f) => ({
          id: f.id,
          gate: f.gate,
          action: f.action,
          clauseId: f.clauseId,
          fromValue: parseJson<unknown>(f.fromValue, null),
          toValue: parseJson<unknown>(f.toValue, null),
          note: f.note,
          createdAt: f.createdAt,
        })),
      });
    },
  }),

  // -------------------------------------------------------------------------
  // Observability — LLM traces + aggregates + vector store stats
  // -------------------------------------------------------------------------
  registerApiRoute("/v1/observability/traces", {
    method: "GET",
    handler: async (c) => {
      await ensureSchema();
      const documentId = c.req.query("documentId");
      let traces = await db
        .select()
        .from(llmTraces)
        .orderBy(desc(llmTraces.createdAt))
        .limit(200);
      if (documentId) traces = traces.filter((t) => t.documentId === documentId);

      const byAgent = new Map<
        string,
        { calls: number; tokens: number; latencyTotal: number; errors: number }
      >();
      for (const t of traces) {
        const agg = byAgent.get(t.agentId) ?? { calls: 0, tokens: 0, latencyTotal: 0, errors: 0 };
        agg.calls += 1;
        agg.tokens += t.totalTokens ?? 0;
        agg.latencyTotal += t.latencyMs;
        if (t.status === "error") agg.errors += 1;
        byAgent.set(t.agentId, agg);
      }

      let qdrantStats: Record<string, { points: number; status: string }> = {};
      try {
        qdrantStats = await collectionStats();
      } catch {
        /* qdrant offline */
      }

      return c.json({
        traces: traces.slice(0, 100).map((t) => ({
          id: t.id,
          correlationId: t.correlationId,
          runId: t.runId,
          documentId: t.documentId,
          agentId: t.agentId,
          model: t.model,
          promptHash: t.promptHash,
          inputTokens: t.inputTokens,
          outputTokens: t.outputTokens,
          totalTokens: t.totalTokens,
          latencyMs: t.latencyMs,
          status: t.status,
          errorMessage: t.errorMessage,
          createdAt: t.createdAt,
        })),
        aggregates: Object.fromEntries(
          [...byAgent.entries()].map(([agent, agg]) => [
            agent,
            {
              calls: agg.calls,
              totalTokens: agg.tokens,
              avgLatencyMs: Math.round(agg.latencyTotal / Math.max(1, agg.calls)),
              errorRate: Number((agg.errors / Math.max(1, agg.calls)).toFixed(3)),
            },
          ]),
        ),
        qdrant: qdrantStats,
      });
    },
  }),
];
