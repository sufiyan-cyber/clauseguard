/**
 * API security middleware for the Mastra server (OWASP API Top-10 aligned):
 *  - Service auth: shared-secret header from the web gateway (x-agent-key)
 *  - Rate limiting: token bucket per client key
 *  - Correlation IDs: accepted from the gateway or minted here, echoed back
 *    on responses and threaded through traces for end-to-end request tracing
 *
 * TLS termination and AES-256 encryption at rest are platform-level concerns
 * (documented in the PRD §11); this module covers the application layer.
 *
 * Note: typed structurally (not via `hono` imports) so the middleware binds
 * cleanly to the Hono version bundled inside @mastra/core.
 */
import { config } from "../config";

/** Minimal structural view of a Hono context — keeps us version-agnostic. */
export interface HttpCtx {
  req: { header(name: string): string | undefined };
  set(key: string, value: unknown): void;
  get(key: string): unknown;
  header(name: string, value: string): void;
  json(obj: unknown, status?: number): Response;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

function takeToken(key: string, perMinute: number): boolean {
  const nowMs = Date.now();
  const bucket = buckets.get(key) ?? { tokens: perMinute, updatedAt: nowMs };
  // Refill proportionally to elapsed time
  const elapsed = (nowMs - bucket.updatedAt) / 60000;
  bucket.tokens = Math.min(perMinute, bucket.tokens + elapsed * perMinute);
  bucket.updatedAt = nowMs;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return true;
}

/** Minimal request view used to detect the open health probe. */
export interface HttpCtxWithPath extends HttpCtx {
  req: HttpCtx["req"] & { path?: string };
}

/** Hono-compatible middleware: auth + rate limit + correlation ID. */
export async function securityMiddleware(
  c: HttpCtxWithPath,
  next: () => Promise<void>,
): Promise<Response | void> {
  // Correlation ID: accept from gateway or mint a new one
  const correlationId = c.req.header("x-correlation-id") ?? crypto.randomUUID();
  c.set("correlationId", correlationId);
  c.header("x-correlation-id", correlationId);

  // /v1/health stays unauthenticated: it's the cloud healthcheck probe and
  // exposes only booleans + model labels (no secrets). Rate limit still applies.
  const isHealthProbe = (c.req.path ?? "").endsWith("/v1/health");

  // Service-to-service auth (skip only when no key is configured — local dev)
  if (config.serviceApiKey && !isHealthProbe) {
    const provided = c.req.header("x-agent-key");
    if (provided !== config.serviceApiKey) {
      return c.json({ error: "Unauthorized", correlationId }, 401);
    }
  }

  // Rate limit per client (gateway forwards the user IP; fall back to direct)
  const clientKey =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "local";
  if (!takeToken(clientKey, config.limits.rateLimitPerMinute)) {
    c.header("retry-after", "60");
    return c.json({ error: "Rate limit exceeded", correlationId }, 429);
  }

  await next();
}

export function getCorrelationId(c: { get(key: string): unknown }): string {
  const id = c.get("correlationId");
  return typeof id === "string" ? id : crypto.randomUUID();
}
