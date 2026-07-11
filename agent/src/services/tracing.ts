/**
 * LLM observability — every agent call is recorded with:
 *   model version, token usage, latency, SHA-256 prompt hash (never the raw
 *   prompt — privacy by design), correlation ID, run ID, document ID.
 *
 * `tracedGenerate` wraps Agent.generate with structured output + retry with
 * exponential backoff on Groq 429/5xx, and persists the trace either way.
 * Complements Mastra's built-in AI tracing (span-level) with a queryable
 * llm_traces table surfaced in the UI observability dashboard.
 */
import { createHash } from "node:crypto";
import type { Agent } from "@mastra/core/agent";
import type { z } from "zod";
import { db, ensureSchema, llmTraces, now, uid } from "./db";

export interface TraceContext {
  correlationId?: string;
  runId?: string;
  documentId?: string;
}

export function promptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 24);
}

async function recordTrace(entry: {
  ctx: TraceContext;
  agentId: string;
  model: string;
  hash: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  latencyMs: number;
  status: "ok" | "error";
  errorMessage?: string;
}) {
  try {
    await ensureSchema();
    await db.insert(llmTraces).values({
      id: uid(),
      correlationId: entry.ctx.correlationId ?? null,
      runId: entry.ctx.runId ?? null,
      documentId: entry.ctx.documentId ?? null,
      agentId: entry.agentId,
      model: entry.model,
      promptHash: entry.hash,
      inputTokens: entry.usage?.inputTokens ?? null,
      outputTokens: entry.usage?.outputTokens ?? null,
      totalTokens: entry.usage?.totalTokens ?? null,
      latencyMs: entry.latencyMs,
      status: entry.status,
      errorMessage: entry.errorMessage ?? null,
      createdAt: now(),
    });
  } catch (err) {
    console.error("[tracing] failed to record trace:", (err as Error).message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /429|rate.?limit|503|502|500|overloaded|timeout|ECONNRESET|fetch failed/i.test(msg);
}

/**
 * Generate a structured object from an agent with tracing + retry.
 * Retries up to 3 times with exponential backoff (Groq free-tier friendly).
 */
export async function tracedGenerate<S extends z.ZodType>(
  agent: Agent<any, any, any>,
  agentId: string,
  prompt: string,
  schema: S,
  ctx: TraceContext,
): Promise<z.infer<S>> {
  const hash = promptHash(prompt);
  let lastError: unknown;
  // Some Groq models (llama-3.x) reject response_format=json_schema; on that
  // signature we retry once with schema-in-prompt injection instead.
  let jsonPromptInjection = false;

  for (let attempt = 0; attempt < 4; attempt++) {
    const started = Date.now();
    try {
      const result = await agent.generate(prompt, {
        structuredOutput: jsonPromptInjection
          ? { schema, jsonPromptInjection: "system" }
          : { schema },
      } as never);
      const usage = (result as { usage?: Record<string, number> }).usage ?? {};
      const model = await resolveModelId(agent);
      await recordTrace({
        ctx,
        agentId,
        model,
        hash,
        usage: {
          inputTokens: usage.inputTokens ?? (usage as never)["promptTokens"],
          outputTokens: usage.outputTokens ?? (usage as never)["completionTokens"],
          totalTokens: usage.totalTokens,
        },
        latencyMs: Date.now() - started,
        status: "ok",
      });
      const object = (result as { object?: z.infer<S> }).object;
      if (object !== undefined && object !== null) return object;
      // Model ignored the schema — try to salvage JSON from raw text.
      const text = (result as { text?: string }).text ?? "";
      const parsed = tryParseJson(text);
      const validated = schema.safeParse(parsed);
      if (validated.success) return validated.data;
      throw new Error(`Structured output missing/invalid for ${agentId}`);
    } catch (err) {
      lastError = err;
      await recordTrace({
        ctx,
        agentId,
        model: await resolveModelId(agent).catch(() => "unknown"),
        hash,
        latencyMs: Date.now() - started,
        status: "error",
        errorMessage: String((err as Error).message).slice(0, 500),
      });
      const message = String((err as Error).message ?? "");
      // Two provider-side structured-output failure classes:
      //  - model doesn't support response_format=json_schema at all
      //  - constrained decoding produced output Groq couldn't validate
      //    ("Failed to validate JSON ... see 'failed_generation'")
      // Both are cured by schema-in-prompt injection + local Zod validation.
      if (
        !jsonPromptInjection &&
        /does not support response format|json_schema|failed to validate json|failed_generation|json_validate/i.test(
          message,
        )
      ) {
        jsonPromptInjection = true;
        console.warn(
          `[${agentId}] provider structured-output failed (${message.slice(0, 80)}…) — retrying with prompt-injected schema`,
        );
        continue;
      }
      // In injection mode a malformed generation is worth one paced retry too.
      if (jsonPromptInjection && attempt < 3 && /structured output missing|invalid/i.test(message)) {
        await sleep(1500);
        continue;
      }
      if (attempt < 3 && isRetryable(err)) {
        const backoff = 2000 * 2 ** attempt + Math.random() * 1000;
        console.warn(`[${agentId}] retryable error, backing off ${Math.round(backoff)}ms: ${(err as Error).message}`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function resolveModelId(agent: Agent<any, any, any>): Promise<string> {
  try {
    const model = await (agent as { getModel?: () => Promise<{ modelId?: string }> }).getModel?.();
    return model?.modelId ?? "unknown";
  } catch {
    return "unknown";
  }
}

function tryParseJson(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?/m, "")
    .replace(/```\s*$/m, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[[{]/);
    if (start === -1) return null;
    for (let end = cleaned.length; end > start; end--) {
      try {
        return JSON.parse(cleaned.slice(start, end));
      } catch {
        /* keep shrinking */
      }
    }
    return null;
  }
}
