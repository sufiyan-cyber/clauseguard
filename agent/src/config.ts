/**
 * Central configuration for the ClauseGuard agent runtime.
 * All secrets come from environment variables — never hardcode keys.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The process CWD differs between `mastra dev` (bundle dir), `mastra start`,
 * and `tsx src/seed/seed.ts` — so relative paths would scatter files across
 * the repo. Anchor everything to the agent package root instead: walk up
 * from CWD until we find our own package.json.
 */
function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        if (JSON.parse(readFileSync(pkg, "utf-8")).name === "clauseguard-agent") return dir;
      } catch {
        /* keep climbing */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const projectRoot = findProjectRoot();

/** Absolute file: URL for libsql (forward slashes, Windows-safe). */
function dbFileUrl(filename: string): string {
  return `file:${path.join(projectRoot, filename).replaceAll("\\", "/")}`;
}

/** Model setting: Mastra router string OR an OpenAI-compatible endpoint. */
export type ModelSetting =
  | string
  | { id: `${string}/${string}`; url: string; apiKey?: string };

/**
 * Resolve a model env var. Two forms:
 *  - "groq/openai/gpt-oss-120b"        → Mastra model router (default)
 *  - "featherless:openai/gpt-oss-120b" → Featherless AI (OpenAI-compatible
 *    fallback provider; needs FEATHERLESS_API_KEY). Demo-day insurance if
 *    Groq free-tier rate limits bite.
 */
function modelFromEnv(raw: string | undefined, fallback: string): ModelSetting {
  const value = (raw ?? fallback).trim();
  if (value.startsWith("featherless:")) {
    return {
      id: value.slice("featherless:".length) as `${string}/${string}`,
      url: "https://api.featherless.ai/v1",
      apiKey: process.env.FEATHERLESS_API_KEY,
    };
  }
  return value;
}

/** Human-readable model label for health/observability output. */
export function modelLabel(m: ModelSetting): string {
  return typeof m === "string" ? m : `featherless:${m.id}`;
}

export const config = {
  /**
   * Model for heavy reasoning (risk analysis, redlines, reports).
   * gpt-oss-120b on Groq supports strict structured outputs (constrained
   * decoding) — agent JSON contracts are enforced at the decoder level.
   */
  reasoningModel: modelFromEnv(process.env.REASONING_MODEL, "groq/openai/gpt-oss-120b"),
  /** Model for fast/cheap tasks (classification, parsing metadata). */
  fastModel: modelFromEnv(process.env.FAST_MODEL, "groq/openai/gpt-oss-20b"),

  qdrant: {
    url: process.env.QDRANT_URL ?? "http://localhost:6333",
    apiKey: process.env.QDRANT_API_KEY || undefined,
    collections: {
      clauseLibrary: "clause_library",
      documentClauses: "document_clauses",
      reviewMemory: "review_memory",
    },
    /** bge-small-en-v1.5 output dimension (fastembed, runs locally — free). */
    vectorSize: 384,
  },

  enkrypt: {
    apiKey: process.env.ENKRYPT_API_KEY ?? "",
    baseUrl: process.env.ENKRYPT_BASE_URL ?? "https://api.enkryptai.com",
    /** Minimum adherence score (0-1) for a grounding gate to pass. */
    adherenceThreshold: Number(process.env.ENKRYPT_ADHERENCE_THRESHOLD ?? 0.6),
    relevancyThreshold: Number(process.env.ENKRYPT_RELEVANCY_THRESHOLD ?? 0.6),
  },

  /** Shared secret required on every request from the web gateway. */
  serviceApiKey: process.env.AGENT_API_KEY ?? "",

  /** Mastra storage (workflow snapshots, memory, traces). */
  dbUrl: process.env.DATABASE_URL ?? dbFileUrl("clauseguard.db"),
  /** App tables (documents, clauses, runs, verdicts...) — separate file to
   *  avoid SQLite write contention with Mastra's own storage client. */
  appDbUrl: process.env.APP_DATABASE_URL ?? dbFileUrl("clauseguard-app.db"),
  uploadDir: process.env.UPLOAD_DIR ?? path.join(projectRoot, "uploads"),
  /** Local ONNX embedding model cache (fastembed). On cloud hosts point this
   *  at the persistent volume (e.g. /data/fastembed-cache). */
  embedCacheDir: process.env.FASTEMBED_CACHE_DIR ?? path.join(projectRoot, ".fastembed-cache"),

  limits: {
    maxUploadBytes: 10 * 1024 * 1024, // 10 MB
    /** Max clauses analyzed per document (keeps Groq free-tier TPM in check). */
    maxClauses: 40,
    /** Clauses per LLM call during batch stages. */
    classifyBatchSize: 10,
    riskBatchSize: 4,
    /** Requests per minute per client for the rate limiter. */
    rateLimitPerMinute: 60,
  },

  disclaimer:
    "This report is AI-generated, informational, and does not constitute legal advice. " +
    "Consult a qualified attorney before acting on any finding.",
} as const;

export type RiskLevel = "low" | "medium" | "high";
