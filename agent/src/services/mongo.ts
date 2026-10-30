/**
 * MongoDB Persistence & Intelligence Service for ClauseGuard.
 *
 * Provides native document storage for:
 *  - contracts (documents)
 *  - clauses (with rich nested benchmark refs, key terms, redlines)
 *  - workflow runs & step logs (atomic $push updates)
 *  - Enkrypt AI safety verdicts (G1-G4 audit trail)
 *  - LLM observability traces & token usage
 *  - interactive legal Q&A messages with citations
 *  - human review feedback & overrides
 *
 * Designed with automatic URI credential normalization, index initialization,
 * health status reporting, and trace aggregation pipelines.
 */
import { MongoClient, Db, Collection } from "mongodb";
import { config } from "../config";

// ---------------------------------------------------------------------------
// Document Interfaces
// ---------------------------------------------------------------------------

export interface MongoDocument {
  id: string;
  filename: string;
  mime: string;
  storagePath: string;
  title?: string | null;
  status: string;
  workflowRunId?: string | null;
  correlationId?: string | null;
  report?: unknown;
  reportJson?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MongoClause {
  id: string;
  documentId: string;
  ordinal: number;
  heading?: string | null;
  text: string;
  clauseType?: string | null;
  keyTerms?: string[] | string | null;
  riskLevel?: "low" | "medium" | "high" | null;
  riskScore?: number | null;
  riskRationale?: string | null;
  benchmarkRefs?: unknown;
  redlineText?: string | null;
  redlineRationale?: string | null;
  redlineStatus: string;
  humanOverride?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface RunStepEntry {
  step: string;
  status: "started" | "completed" | "failed" | "suspended";
  detail?: string | null;
  at: string;
}

export interface MongoRun {
  runId: string;
  documentId: string;
  workflowId: string;
  status: string;
  currentStep?: string | null;
  stepLog: RunStepEntry[];
  suspendPayload?: unknown;
  correlationId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MongoEnkryptVerdict {
  id: string;
  documentId?: string | null;
  runId?: string | null;
  gate: string;
  subjectType: string;
  subjectId?: string | null;
  verdict: string;
  scores?: unknown;
  raw?: unknown;
  latencyMs?: number | null;
  createdAt: string;
}

export interface MongoLlmTrace {
  id: string;
  correlationId?: string | null;
  runId?: string | null;
  documentId?: string | null;
  agentId: string;
  model: string;
  promptHash: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  latencyMs: number;
  status: "ok" | "error";
  errorMessage?: string | null;
  createdAt: string;
}

export interface MongoQaMessage {
  id: string;
  documentId: string;
  role: "user" | "assistant";
  content: string;
  citations?: unknown;
  verdictId?: string | null;
  createdAt: string;
}

export interface MongoReviewFeedback {
  id: string;
  documentId: string;
  clauseId?: string | null;
  gate: string;
  action: string;
  fromValue?: unknown;
  toValue?: unknown;
  note?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Client & Connection Lifecycle
// ---------------------------------------------------------------------------

let client: MongoClient | null = null;
let dbInstance: Db | null = null;
let isConnecting = false;
let lastError: string | null = null;
let lastConnectAttempt = 0;
const RETRY_COOLDOWN_MS = 30000;
let indexesCreated = false;

/**
 * Safely normalize a MongoDB URI. If credentials contain unencoded special characters
 * (@, #, $, etc.), encode only the password so the driver does not throw URI malformed.
 */
function normalizeMongoUri(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    // Check if it already parses as valid URL
    new URL(trimmed);
    return trimmed;
  } catch {
    // Try encoding the password part if user/password separator exists
    const match = trimmed.match(/^(mongodb(?:\+srv)?:\/\/)([^:]+):(.+)@([^/?#]+)(.*)$/);
    if (match) {
      const [, proto, user, pass, host, rest] = match;
      return `${proto}${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}${rest}`;
    }
    return trimmed;
  }
}

export async function getMongoDb(): Promise<Db | null> {
  const uri = normalizeMongoUri(config.mongodb.uri);
  if (!uri) return null;

  if (dbInstance && client) return dbInstance;
  if (isConnecting) return null;
  if (lastError && Date.now() - lastConnectAttempt < RETRY_COOLDOWN_MS) {
    return null;
  }
  lastConnectAttempt = Date.now();
  isConnecting = true;
  try {
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    });
    await client.connect();
    dbInstance = client.db(config.mongodb.dbName);
    lastError = null;
    console.info(`[MongoDB] Connected successfully to database: "${config.mongodb.dbName}"`);

    if (!indexesCreated) {
      await initMongoIndexes(dbInstance).catch((err) =>
        console.warn("[MongoDB] Index initialization warning:", err.message),
      );
      indexesCreated = true;
    }

    return dbInstance;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lastError = msg;
    console.warn(`[MongoDB] Connection attempt failed: ${msg}`);
    client = null;
    dbInstance = null;
    return null;
  } finally {
    isConnecting = false;
  }
}

export function isMongoActive(): boolean {
  return dbInstance !== null;
}

/** Check MongoDB health status for /v1/health probe */
export async function getMongoStatus(): Promise<{
  configured: boolean;
  connected: boolean;
  database: string;
  error?: string | null;
  latencyMs?: number;
}> {
  const configured = Boolean(config.mongodb.uri.trim());
  if (!configured) {
    return {
      configured: false,
      connected: false,
      database: config.mongodb.dbName,
      error: "MONGODB_URI not configured (using local LibSQL/SQLite)",
    };
  }

  const start = Date.now();
  try {
    const db = await getMongoDb();
    if (!db) {
      return {
        configured: true,
        connected: false,
        database: config.mongodb.dbName,
        error: lastError ?? "Failed to connect",
      };
    }
    await db.command({ ping: 1 });
    return {
      configured: true,
      connected: true,
      database: config.mongodb.dbName,
      latencyMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      configured: true,
      connected: false,
      database: config.mongodb.dbName,
      error: msg,
    };
  }
}

// ---------------------------------------------------------------------------
// Index Creation
// ---------------------------------------------------------------------------

async function initMongoIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection("documents").createIndex({ id: 1 }, { unique: true }),
    db.collection("documents").createIndex({ createdAt: -1 }),

    db.collection("clauses").createIndex({ id: 1 }, { unique: true }),
    db.collection("clauses").createIndex({ documentId: 1, ordinal: 1 }),

    db.collection("runs").createIndex({ runId: 1 }, { unique: true }),
    db.collection("runs").createIndex({ documentId: 1 }),

    db.collection("enkrypt_verdicts").createIndex({ id: 1 }, { unique: true }),
    db.collection("enkrypt_verdicts").createIndex({ documentId: 1, createdAt: -1 }),

    db.collection("llm_traces").createIndex({ id: 1 }, { unique: true }),
    db.collection("llm_traces").createIndex({ correlationId: 1 }),
    db.collection("llm_traces").createIndex({ createdAt: -1 }),

    db.collection("qa_messages").createIndex({ id: 1 }, { unique: true }),
    db.collection("qa_messages").createIndex({ documentId: 1, createdAt: 1 }),

    db.collection("review_feedback").createIndex({ id: 1 }, { unique: true }),
    db.collection("review_feedback").createIndex({ documentId: 1, createdAt: -1 }),
  ]);
  console.info("[MongoDB] Primary lookup & performance indexes verified.");
}

// ---------------------------------------------------------------------------
// Document Repository Operations
// ---------------------------------------------------------------------------

export async function mongoSaveDocument(doc: MongoDocument): Promise<void> {
  const db = await getMongoDb();
  if (!db) return;
  await db
    .collection<MongoDocument>("documents")
    .updateOne({ id: doc.id }, { $set: doc }, { upsert: true });
}

export async function mongoGetDocument(id: string): Promise<MongoDocument | null> {
  const db = await getMongoDb();
  if (!db) return null;
  return db.collection<MongoDocument>("documents").findOne({ id });
}

export async function mongoGetDocuments(): Promise<MongoDocument[]> {
  const db = await getMongoDb();
  if (!db) return [];
  return db
    .collection<MongoDocument>("documents")
    .find()
    .sort({ createdAt: -1 })
    .toArray();
}

export async function mongoUpdateDocument(
  id: string,
  update: Partial<MongoDocument>,
): Promise<void> {
  const db = await getMongoDb();
  if (!db) return;
  await db.collection<MongoDocument>("documents").updateOne({ id }, { $set: update });
}

// ---------------------------------------------------------------------------
// Clause Repository Operations
// ---------------------------------------------------------------------------

export async function mongoSaveClauses(clauses: MongoClause[]): Promise<void> {
  const db = await getMongoDb();
  if (!db || clauses.length === 0) return;
  const col = db.collection<MongoClause>("clauses");
  const ops = clauses.map((c) => ({
    updateOne: {
      filter: { id: c.id },
      update: { $set: c },
      upsert: true,
    },
  }));
  await col.bulkWrite(ops);
}

export async function mongoGetClauses(documentId: string): Promise<MongoClause[]> {
  const db = await getMongoDb();
  if (!db) return [];
  return db
    .collection<MongoClause>("clauses")
    .find({ documentId })
    .sort({ ordinal: 1 })
    .toArray();
}

export async function mongoDeleteClausesByDocument(documentId: string): Promise<void> {
  const db = await getMongoDb();
  if (!db) return;
  await db.collection<MongoClause>("clauses").deleteMany({ documentId });
}

export async function mongoUpdateClause(
  id: string,
  update: Partial<MongoClause>,
): Promise<void> {
  const db = await getMongoDb();
  if (!db) return;
  await db.collection<MongoClause>("clauses").updateOne({ id }, { $set: update });
}

// ---------------------------------------------------------------------------
// Workflow Run Operations
// ---------------------------------------------------------------------------

export async function mongoSaveRun(run: MongoRun): Promise<void> {
  const db = await getMongoDb();
  if (!db) return;
  await db
    .collection<MongoRun>("runs")
    .updateOne({ runId: run.runId }, { $set: run }, { upsert: true });
}

export async function mongoGetRun(runId: string): Promise<MongoRun | null> {
  const db = await getMongoDb();
  if (!db) return null;
  return db.collection<MongoRun>("runs").findOne({ runId });
}

export async function mongoUpdateRun(runId: string, update: Partial<MongoRun>): Promise<void> {
  const db = await getMongoDb();
  if (!db) return;
  await db.collection<MongoRun>("runs").updateOne({ runId }, { $set: update });
}

export async function mongoAppendRunStep(
  runId: string,
  step: string,
  status: "started" | "completed" | "failed" | "suspended",
  detail?: string | null,
): Promise<void> {
  const db = await getMongoDb();
  if (!db) return;
  const entry: RunStepEntry = {
    step,
    status,
    detail: detail ?? null,
    at: new Date().toISOString(),
  };
  await db.collection<MongoRun>("runs").updateOne(
    { runId },
    {
      $push: { stepLog: entry },
      $set: { currentStep: step, status: status === "suspended" ? `suspended_${step}` : undefined, updatedAt: entry.at },
    },
  );
}

// ---------------------------------------------------------------------------
// Enkrypt Safety Verdicts
// ---------------------------------------------------------------------------

export async function mongoSaveEnkryptVerdict(verdict: MongoEnkryptVerdict): Promise<void> {
  const db = await getMongoDb();
  if (!db) return;
  await db
    .collection<MongoEnkryptVerdict>("enkrypt_verdicts")
    .updateOne({ id: verdict.id }, { $set: verdict }, { upsert: true });
}

export async function mongoGetEnkryptVerdicts(
  documentId: string,
): Promise<MongoEnkryptVerdict[]> {
  const db = await getMongoDb();
  if (!db) return [];
  return db
    .collection<MongoEnkryptVerdict>("enkrypt_verdicts")
    .find({ documentId })
    .sort({ createdAt: -1 })
    .toArray();
}

// ---------------------------------------------------------------------------
// LLM Traces & Observability Aggregation
// ---------------------------------------------------------------------------

export async function mongoSaveLlmTrace(trace: MongoLlmTrace): Promise<void> {
  const db = await getMongoDb();
  if (!db) return;
  await db
    .collection<MongoLlmTrace>("llm_traces")
    .updateOne({ id: trace.id }, { $set: trace }, { upsert: true });
}

export async function mongoGetLlmTraces(limit = 100): Promise<MongoLlmTrace[]> {
  const db = await getMongoDb();
  if (!db) return [];
  return db
    .collection<MongoLlmTrace>("llm_traces")
    .find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

/** Rich token & latency aggregations for the observability dashboard */
export async function mongoGetLlmStats(): Promise<{
  totalTraces: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgLatencyMs: number;
  errorCount: number;
  agentBreakdown: Array<{ agentId: string; count: number; totalTokens: number; avgLatency: number }>;
} | null> {
  const db = await getMongoDb();
  if (!db) return null;

  try {
    const pipeline = [
      {
        $group: {
          _id: "$agentId",
          count: { $sum: 1 },
          totalTokens: { $sum: { $ifNull: ["$totalTokens", 0] } },
          totalInputTokens: { $sum: { $ifNull: ["$inputTokens", 0] } },
          totalOutputTokens: { $sum: { $ifNull: ["$outputTokens", 0] } },
          avgLatency: { $avg: "$latencyMs" },
          errors: { $sum: { $cond: [{ $eq: ["$status", "error"] }, 1, 0] } },
        },
      },
    ];

    const results = await db.collection("llm_traces").aggregate(pipeline).toArray();
    let totalTraces = 0;
    let totalTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let errorCount = 0;
    let weightedLatencySum = 0;

    const agentBreakdown = results.map((r: any) => {
      totalTraces += r.count;
      totalTokens += r.totalTokens;
      totalInputTokens += r.totalInputTokens;
      totalOutputTokens += r.totalOutputTokens;
      errorCount += r.errors;
      weightedLatencySum += r.avgLatency * r.count;
      return {
        agentId: r._id,
        count: r.count,
        totalTokens: r.totalTokens,
        avgLatency: Math.round(r.avgLatency || 0),
      };
    });

    return {
      totalTraces,
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      avgLatencyMs: totalTraces > 0 ? Math.round(weightedLatencySum / totalTraces) : 0,
      errorCount,
      agentBreakdown,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// QA Chat Messages
// ---------------------------------------------------------------------------

export async function mongoSaveQaMessage(msg: MongoQaMessage): Promise<void> {
  const db = await getMongoDb();
  if (!db) return;
  await db
    .collection<MongoQaMessage>("qa_messages")
    .updateOne({ id: msg.id }, { $set: msg }, { upsert: true });
}

export async function mongoGetQaMessages(documentId: string): Promise<MongoQaMessage[]> {
  const db = await getMongoDb();
  if (!db) return [];
  return db
    .collection<MongoQaMessage>("qa_messages")
    .find({ documentId })
    .sort({ createdAt: 1 })
    .toArray();
}

// ---------------------------------------------------------------------------
// Human Review Feedback
// ---------------------------------------------------------------------------

export async function mongoSaveReviewFeedback(fb: MongoReviewFeedback): Promise<void> {
  const db = await getMongoDb();
  if (!db) return;
  await db
    .collection<MongoReviewFeedback>("review_feedback")
    .updateOne({ id: fb.id }, { $set: fb }, { upsert: true });
}

export async function mongoGetReviewFeedback(
  documentId: string,
): Promise<MongoReviewFeedback[]> {
  const db = await getMongoDb();
  if (!db) return [];
  return db
    .collection<MongoReviewFeedback>("review_feedback")
    .find({ documentId })
    .sort({ createdAt: -1 })
    .toArray();
}
