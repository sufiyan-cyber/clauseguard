export type RiskLevel = "low" | "medium" | "high";

export interface DocumentSummary {
  id: string;
  filename: string;
  title: string | null;
  status: string;
  workflowRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BenchmarkRef {
  label: string;
  id: string;
  clauseType?: string;
  jurisdiction?: string;
  riskBaseline?: string;
  snippet?: string;
  source?: string;
}

export interface Clause {
  id: string;
  ordinal: number;
  heading: string | null;
  text: string;
  clauseType: string | null;
  keyTerms: string[];
  riskLevel: RiskLevel | null;
  riskScore: number | null;
  riskRationale: string | null;
  benchmarkRefs: BenchmarkRef[];
  redlineText: string | null;
  redlineRationale: string | null;
  redlineStatus: "none" | "proposed" | "approved" | "edited" | "rejected";
  humanOverride: { field: string; from: string | null; to: string; note: string | null } | null;
}

export interface Report {
  executiveSummary: string;
  overallRisk: RiskLevel;
  topConcerns: string[];
  recommendations: string[];
  stats: {
    totalClauses: number;
    high: number;
    medium: number;
    low: number;
    redlinesApproved: number;
    humanOverrides: number;
  };
  completedAt: string;
}

export interface DocumentDetail {
  document: {
    id: string;
    filename: string;
    title: string | null;
    status: string;
    workflowRunId: string | null;
    report: Report | null;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
  };
  clauses: Clause[];
}

export interface StepLogEntry {
  step: string;
  status: "started" | "completed" | "failed" | "suspended";
  detail: string | null;
  at: string;
}

export interface RunState {
  runId: string;
  documentId: string;
  status: string;
  currentStep: string | null;
  stepLog: StepLogEntry[];
  suspendPayload: unknown;
  updatedAt: string;
}

export interface Citation {
  ordinal: number;
  quote: string;
}

export interface QaMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  verdictId: string | null;
  createdAt: string;
}

export interface QaResponse {
  messageId: string;
  answer: string;
  citations: Citation[];
  confidence: "high" | "medium" | "low";
  notFound: boolean;
  blocked: boolean;
  gate: { verdict: string; scores: Record<string, unknown>; reasons: string[]; verdictId: string };
}

export interface Verdict {
  id: string;
  gate: "G1" | "G2" | "G3" | "G4";
  subjectType: string;
  subjectId: string | null;
  verdict: "pass" | "fail" | "warn" | "skipped";
  scores: Record<string, unknown>;
  latencyMs: number | null;
  createdAt: string;
}

export interface HumanFeedback {
  id: string;
  gate: string;
  action: string;
  clauseId: string | null;
  fromValue: unknown;
  toValue: unknown;
  note: string | null;
  createdAt: string;
}

export interface LlmTrace {
  id: string;
  correlationId: string | null;
  runId: string | null;
  documentId: string | null;
  agentId: string;
  model: string;
  promptHash: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  status: "ok" | "error";
  errorMessage: string | null;
  createdAt: string;
}

export interface TracesResponse {
  traces: LlmTrace[];
  aggregates: Record<
    string,
    { calls: number; totalTokens: number; avgLatencyMs: number; errorRate: number }
  >;
  qdrant: Record<string, { points: number; status: string }>;
}
