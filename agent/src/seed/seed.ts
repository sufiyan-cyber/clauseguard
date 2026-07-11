/**
 * Seed script: creates Qdrant collections (with HNSW tuning, scalar
 * quantization, and dense+sparse named vectors) and loads the benchmark
 * clause library. Idempotent — deterministic UUIDs derived from content.
 *
 *   npm run seed
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { ensureCollections, upsertBenchmarks, collectionStats } from "../services/qdrant";
import { CLAUSE_LIBRARY } from "./clause-library";

/** Deterministic UUID v5-style id from clause text (stable across re-seeds). */
function stableId(text: string): string {
  const h = createHash("sha256").update(text).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), `4${h.slice(13, 16)}`, `8${h.slice(17, 20)}`, h.slice(20, 32)].join("-");
}

async function main() {
  console.log("→ Ensuring Qdrant collections (HNSW m=16 ef=200, int8 scalar quantization, dense+SPLADE)...");
  await ensureCollections();

  console.log(`→ Embedding ${CLAUSE_LIBRARY.length} benchmark clauses (dense + sparse, local models)...`);
  console.log("  (first run downloads ONNX models to .fastembed-cache — a few minutes)");
  await upsertBenchmarks(
    CLAUSE_LIBRARY.map((c) => ({
      id: stableId(c.text),
      text: c.text,
      clauseType: c.clauseType,
      jurisdiction: c.jurisdiction,
      riskBaseline: c.riskBaseline,
      source: c.source,
      guidance: c.guidance,
    })),
  );

  const stats = await collectionStats();
  console.log("→ Done. Collection stats:");
  for (const [name, s] of Object.entries(stats)) {
    console.log(`   ${name}: ${s.points} points (${s.status})`);
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
