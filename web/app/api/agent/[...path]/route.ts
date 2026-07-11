/**
 * API Gateway → Mastra agent runtime.
 *
 * The browser only ever talks to this Next.js route. Gateway duties:
 *  - mint a correlation ID per request (x-correlation-id) for end-to-end tracing
 *  - attach the service credential (x-agent-key) — never exposed to the client
 *  - forward the client IP for per-user rate limiting at the runtime
 *  - apply a first-line token-bucket rate limit here at the edge
 *  - stream SSE bodies straight through without buffering
 */
import { NextRequest } from "next/server";

// Vercel: keep this a dynamic Node function and allow long-lived SSE streams
// up to the plan limit; the client EventSource auto-reconnects on cutoff.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:4111";
const AGENT_API_KEY = process.env.AGENT_API_KEY ?? "";

const RATE_LIMIT_PER_MINUTE = 120;
const buckets = new Map<string, { tokens: number; updatedAt: number }>();

function allow(key: string): boolean {
  const nowMs = Date.now();
  const b = buckets.get(key) ?? { tokens: RATE_LIMIT_PER_MINUTE, updatedAt: nowMs };
  b.tokens = Math.min(
    RATE_LIMIT_PER_MINUTE,
    b.tokens + ((nowMs - b.updatedAt) / 60000) * RATE_LIMIT_PER_MINUTE,
  );
  b.updatedAt = nowMs;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}

async function proxy(req: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "browser";
  if (!allow(clientIp)) {
    return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const correlationId = crypto.randomUUID();
  const target = new URL(`/v1/${path.join("/")}`, AGENT_URL);
  req.nextUrl.searchParams.forEach((v, k) => target.searchParams.set(k, v));

  const headers = new Headers();
  headers.set("x-correlation-id", correlationId);
  headers.set("x-forwarded-for", clientIp);
  if (AGENT_API_KEY) headers.set("x-agent-key", AGENT_API_KEY);
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    // @ts-expect-error — required by Node fetch when forwarding a request body stream
    duplex: "half",
    signal: req.signal,
  });

  // Pass SSE and JSON straight through; echo the correlation ID to the browser.
  const responseHeaders = new Headers();
  const upstreamType = upstream.headers.get("content-type");
  if (upstreamType) responseHeaders.set("content-type", upstreamType);
  responseHeaders.set("x-correlation-id", correlationId);
  if (upstreamType?.includes("text/event-stream")) {
    responseHeaders.set("cache-control", "no-cache");
    responseHeaders.set("connection", "keep-alive");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, ctx.params);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, ctx.params);
}
