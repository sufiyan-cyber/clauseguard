/**
 * Application persistence layer (documents, clauses, runs, audit, traces).
 * Uses Drizzle ORM over LibSQL. Mastra's own workflow snapshots/memory live in
 * the same database file via @mastra/libsql, but in Mastra-managed tables.
 */
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { config } from "../config";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  storagePath: text("storage_path").notNull(),
  title: text("title"),
  status: text("status").notNull().default("uploaded"),
  workflowRunId: text("workflow_run_id"),
  correlationId: text("correlation_id"),
  reportJson: text("report_json"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const clauses = sqliteTable("clauses", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  heading: text("heading"),
  text: text("text").notNull(),
  clauseType: text("clause_type"),
  keyTerms: text("key_terms"), // JSON string[]
  riskLevel: text("risk_level"), // low | medium | high
  riskScore: integer("risk_score"), // 0-100
  riskRationale: text("risk_rationale"),
  benchmarkRefs: text("benchmark_refs"), // JSON [{id, clauseType, snippet, score}]
  redlineText: text("redline_text"),
  redlineRationale: text("redline_rationale"),
  redlineStatus: text("redline_status").notNull().default("none"), // none|proposed|approved|edited|rejected
  humanOverride: text("human_override"), // JSON {field, from, to, note}
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const runs = sqliteTable("runs", {
  runId: text("run_id").primaryKey(),
  documentId: text("document_id").notNull(),
  workflowId: text("workflow_id").notNull(),
  status: text("status").notNull(), // running|suspended_risk_review|suspended_final_approval|completed|failed
  currentStep: text("current_step"),
  stepLog: text("step_log").notNull().default("[]"), // JSON [{step,status,detail,at}]
  suspendPayload: text("suspend_payload"), // JSON payload shown to the human at a gate
  correlationId: text("correlation_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const enkryptVerdicts = sqliteTable("enkrypt_verdicts", {
  id: text("id").primaryKey(),
  documentId: text("document_id"),
  runId: text("run_id"),
  gate: text("gate").notNull(), // G1|G2|G3|G4
  subjectType: text("subject_type").notNull(), // clause|qa|redline|report
  subjectId: text("subject_id"),
  verdict: text("verdict").notNull(), // pass|fail|warn|skipped
  scores: text("scores"), // JSON {adherence, relevancy, detectorSummary}
  raw: text("raw"), // JSON raw API response (truncated)
  latencyMs: integer("latency_ms"),
  createdAt: text("created_at").notNull(),
});

export const llmTraces = sqliteTable("llm_traces", {
  id: text("id").primaryKey(),
  correlationId: text("correlation_id"),
  runId: text("run_id"),
  documentId: text("document_id"),
  agentId: text("agent_id").notNull(),
  model: text("model").notNull(),
  promptHash: text("prompt_hash").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  latencyMs: integer("latency_ms").notNull(),
  status: text("status").notNull().default("ok"), // ok|error
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
});

export const qaMessages = sqliteTable("qa_messages", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  role: text("role").notNull(), // user|assistant
  content: text("content").notNull(),
  citations: text("citations"), // JSON [{clauseId, ordinal, quote}]
  verdictId: text("verdict_id"),
  createdAt: text("created_at").notNull(),
});

export const reviewFeedback = sqliteTable("review_feedback", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  clauseId: text("clause_id"),
  gate: text("gate").notNull(), // risk_review|final_approval
  action: text("action").notNull(), // approved|overridden|edited|rejected
  fromValue: text("from_value"), // JSON
  toValue: text("to_value"), // JSON
  note: text("note"),
  createdAt: text("created_at").notNull(),
});

// ---------------------------------------------------------------------------
// Client + bootstrap
// ---------------------------------------------------------------------------

let client: Client | null = null;

function getClient(): Client {
  if (!client) {
    client = createClient({ url: config.appDbUrl });
  }
  return client;
}

export const db = drizzle(getClient(), {
  schema: {
    documents,
    clauses,
    runs,
    enkryptVerdicts,
    llmTraces,
    qaMessages,
    reviewFeedback,
  },
});

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded',
  workflow_run_id TEXT,
  correlation_id TEXT,
  report_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clauses (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  clause_type TEXT,
  key_terms TEXT,
  risk_level TEXT,
  risk_score INTEGER,
  risk_rationale TEXT,
  benchmark_refs TEXT,
  redline_text TEXT,
  redline_rationale TEXT,
  redline_status TEXT NOT NULL DEFAULT 'none',
  human_override TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clauses_document ON clauses(document_id);
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_step TEXT,
  step_log TEXT NOT NULL DEFAULT '[]',
  suspend_payload TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_document ON runs(document_id);
CREATE TABLE IF NOT EXISTS enkrypt_verdicts (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  run_id TEXT,
  gate TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  verdict TEXT NOT NULL,
  scores TEXT,
  raw TEXT,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verdicts_document ON enkrypt_verdicts(document_id);
CREATE TABLE IF NOT EXISTS llm_traces (
  id TEXT PRIMARY KEY,
  correlation_id TEXT,
  run_id TEXT,
  document_id TEXT,
  agent_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traces_document ON llm_traces(document_id);
CREATE TABLE IF NOT EXISTS qa_messages (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations TEXT,
  verdict_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qa_document ON qa_messages(document_id);
CREATE TABLE IF NOT EXISTS review_feedback (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  clause_id TEXT,
  gate TEXT NOT NULL,
  action TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
`;

let bootstrapped: Promise<void> | null = null;

/** Idempotent table creation; call before any query path. */
export function ensureSchema(): Promise<void> {
  if (!bootstrapped) {
    bootstrapped = getClient().executeMultiple(BOOTSTRAP_SQL);
  }
  return bootstrapped;
}

export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();

/** Append an entry to a run's step log and update its current step/status. */
export async function logRunStep(
  runId: string,
  step: string,
  status: "started" | "completed" | "failed" | "suspended",
  detail?: string,
) {
  await ensureSchema();
  const c = getClient();
  const res = await c.execute({
    sql: "SELECT step_log FROM runs WHERE run_id = ?",
    args: [runId],
  });
  if (res.rows.length === 0) return;
  const log = JSON.parse((res.rows[0].step_log as string) ?? "[]");
  log.push({ step, status, detail: detail ?? null, at: now() });
  await c.execute({
    sql: "UPDATE runs SET step_log = ?, current_step = ?, updated_at = ? WHERE run_id = ?",
    args: [JSON.stringify(log), step, now(), runId],
  });
}
