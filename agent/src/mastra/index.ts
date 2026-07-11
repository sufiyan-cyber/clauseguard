/**
 * ClauseGuard Mastra runtime:
 *  - 5 specialized agents + legalReviewWorkflow (2 HITL suspend gates)
 *  - LibSQL storage (workflow snapshots survive restarts → resumable gates)
 *  - Observability: Mastra AI tracing → storage (viewable in Mastra Studio),
 *    plus the custom llm_traces table exposed at /api/observability/traces
 *  - Custom API routes behind auth + rate-limit + correlation-ID middleware
 */
import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { PinoLogger } from "@mastra/loggers";
import { Observability, MastraStorageExporter } from "@mastra/observability";
import { config } from "../config";
import { apiRoutes } from "../routes/api";
import { securityMiddleware } from "../services/security";
import { agents } from "./agents";
import { legalReviewWorkflow } from "./workflows/legal-review";

export const mastra = new Mastra({
  agents,
  workflows: { legalReviewWorkflow },
  storage: new LibSQLStore({ id: "clauseguard-storage", url: config.dbUrl }),
  logger: new PinoLogger({ name: "clauseguard-agent", level: "info" }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: "clauseguard-agent",
        exporters: [new MastraStorageExporter()],
      },
    },
    sensitiveDataFilter: true,
  }),
  server: {
    port: Number(process.env.PORT ?? 4111),
    middleware: [{ path: "/v1/*", handler: securityMiddleware }],
    apiRoutes,
    cors: {
      origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "x-agent-key", "x-correlation-id"],
      exposeHeaders: ["x-correlation-id"],
      credentials: false,
    },
  },
});
