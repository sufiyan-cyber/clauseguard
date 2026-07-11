/**
 * Qdrant vector store — three collections:
 *  - clause_library:   market-standard benchmark clauses (seeded)
 *  - document_clauses: live document vectors for RAG / Q&A
 *  - review_memory:    human override history → the learning loop
 *
 * Production tuning per collection:
 *  - Named vectors: "dense" (BGE-small-en-v1.5, 384d, cosine)
 *                 + "splade" sparse (SPLADE++ learned lexical expansion)
 *  - True hybrid search: dense + sparse prefetch fused server-side with
 *    Reciprocal Rank Fusion via Qdrant's Query API
 *  - HNSW: m=16, ef_construct=200 (recall-optimized for small/mid corpora)
 *  - Scalar quantization: int8, quantile 0.99, always_ram (≈4x memory cut,
 *    negligible recall loss; rescore with originals at query time)
 *  - Payload indexes on filterable fields (clauseType, jurisdiction, documentId)
 */
import { QdrantClient } from "@qdrant/js-client-rest";
import { config } from "../config";
import {
  embedQuery,
  embedSparseQuery,
  embedSparseTexts,
  embedTexts,
  type SparseVector,
} from "./embeddings";

let clientInstance: QdrantClient | null = null;

export function qdrant(): QdrantClient {
  if (!clientInstance) {
    clientInstance = new QdrantClient({
      url: config.qdrant.url,
      apiKey: config.qdrant.apiKey,
      checkCompatibility: false,
    });
  }
  return clientInstance;
}

const DENSE = "dense";
const SPARSE = "splade";

async function ensureCollection(
  name: string,
  payloadIndexes: Array<{ field: string; schema: "keyword" | "text" | "integer" }>,
) {
  const client = qdrant();
  const { exists } = await client.collectionExists(name);
  if (!exists) {
    await client.createCollection(name, {
      vectors: {
        [DENSE]: {
          size: config.qdrant.vectorSize,
          distance: "Cosine",
          hnsw_config: { m: 16, ef_construct: 200 },
          quantization_config: {
            scalar: { type: "int8", quantile: 0.99, always_ram: true },
          },
        },
      },
      sparse_vectors: {
        [SPARSE]: { modifier: "none" },
      },
    });
    for (const idx of payloadIndexes) {
      await client.createPayloadIndex(name, {
        field_name: idx.field,
        field_schema: idx.schema,
        wait: true,
      });
    }
  }
}

/** Idempotent setup of all three collections. */
export async function ensureCollections() {
  const { clauseLibrary, documentClauses, reviewMemory } = config.qdrant.collections;
  await ensureCollection(clauseLibrary, [
    { field: "clauseType", schema: "keyword" },
    { field: "jurisdiction", schema: "keyword" },
    { field: "riskBaseline", schema: "keyword" },
  ]);
  await ensureCollection(documentClauses, [
    { field: "documentId", schema: "keyword" },
    { field: "clauseType", schema: "keyword" },
  ]);
  await ensureCollection(reviewMemory, [
    { field: "clauseType", schema: "keyword" },
    { field: "documentId", schema: "keyword" },
    { field: "action", schema: "keyword" },
  ]);
}

/** Build point vectors: dense always, sparse when SPLADE is available. */
async function buildVectors(texts: string[]): Promise<Array<Record<string, unknown>>> {
  const dense = await embedTexts(texts);
  const sparse = await embedSparseTexts(texts);
  return texts.map((_, i) => {
    const vectors: Record<string, unknown> = { [DENSE]: dense[i] };
    if (sparse) vectors[SPARSE] = { values: sparse[i].values, indices: sparse[i].indices };
    return vectors;
  });
}

type QdrantFilter = Record<string, unknown>;

/**
 * Hybrid query: dense + sparse prefetch, fused server-side with RRF.
 * Falls back to dense-only when SPLADE is unavailable.
 */
async function hybridQuery(
  collection: string,
  queryText: string,
  opts: { filter?: QdrantFilter; limit: number; scoreThreshold?: number },
) {
  const client = qdrant();
  const denseVec = await embedQuery(queryText);
  const sparseVec: SparseVector | null = await embedSparseQuery(queryText);

  if (sparseVec && sparseVec.indices.length > 0) {
    const res = await client.query(collection, {
      prefetch: [
        {
          query: denseVec,
          using: DENSE,
          filter: opts.filter,
          limit: opts.limit * 3,
          params: { hnsw_ef: 128, quantization: { rescore: true } },
        },
        {
          query: { values: sparseVec.values, indices: sparseVec.indices },
          using: SPARSE,
          filter: opts.filter,
          limit: opts.limit * 3,
        },
      ],
      query: { fusion: "rrf" },
      limit: opts.limit,
      with_payload: true,
    });
    return res.points;
  }

  const res = await client.query(collection, {
    query: denseVec,
    using: DENSE,
    filter: opts.filter,
    limit: opts.limit,
    score_threshold: opts.scoreThreshold,
    with_payload: true,
    params: { hnsw_ef: 128, quantization: { rescore: true } },
  });
  return res.points;
}

export interface BenchmarkHit {
  id: string;
  score: number;
  text: string;
  clauseType?: string;
  jurisdiction?: string;
  riskBaseline?: string;
  source?: string;
  guidance?: string;
}

/** Hybrid search over the market-standard clause library. */
export async function searchBenchmarks(
  query: string,
  opts: { clauseType?: string; limit?: number } = {},
): Promise<BenchmarkHit[]> {
  const filter = opts.clauseType
    ? { must: [{ key: "clauseType", match: { value: opts.clauseType } }] }
    : undefined;
  const points = await hybridQuery(config.qdrant.collections.clauseLibrary, query, {
    filter,
    limit: opts.limit ?? 4,
  });
  return points.map((hit) => {
    const p = (hit.payload ?? {}) as Record<string, unknown>;
    return {
      id: String(hit.id),
      score: hit.score,
      text: String(p.text ?? ""),
      clauseType: p.clauseType as string | undefined,
      jurisdiction: p.jurisdiction as string | undefined,
      riskBaseline: p.riskBaseline as string | undefined,
      source: p.source as string | undefined,
      guidance: p.guidance as string | undefined,
    };
  });
}

/** Upsert benchmark clauses into the library (used by the seed script). */
export async function upsertBenchmarks(
  items: Array<{
    id: string;
    text: string;
    clauseType: string;
    jurisdiction: string;
    riskBaseline: string;
    source: string;
    guidance?: string;
  }>,
) {
  if (items.length === 0) return;
  const vectors = await buildVectors(items.map((i) => i.text));
  await qdrant().upsert(config.qdrant.collections.clauseLibrary, {
    wait: true,
    points: items.map((item, i) => ({
      id: item.id,
      vector: vectors[i] as never,
      payload: {
        text: item.text,
        clauseType: item.clauseType,
        jurisdiction: item.jurisdiction,
        riskBaseline: item.riskBaseline,
        source: item.source,
        guidance: item.guidance ?? null,
      },
    })),
  });
}

/** Index a document's clauses for RAG-grounded Q&A. */
export async function indexDocumentClauses(
  documentId: string,
  items: Array<{
    id: string;
    ordinal: number;
    heading?: string | null;
    text: string;
    clauseType?: string | null;
  }>,
) {
  if (items.length === 0) return;
  const vectors = await buildVectors(items.map((c) => c.text));
  await qdrant().upsert(config.qdrant.collections.documentClauses, {
    wait: true,
    points: items.map((c, i) => ({
      id: c.id,
      vector: vectors[i] as never,
      payload: {
        documentId,
        ordinal: c.ordinal,
        heading: c.heading ?? null,
        clauseType: c.clauseType ?? null,
        text: c.text,
      },
    })),
  });
}

export interface ClauseHit {
  clauseId: string;
  ordinal: number;
  heading: string | null;
  clauseType: string | null;
  text: string;
  score: number;
}

/** Hybrid retrieval over one document's clauses (used by legalQaAgent). */
export async function searchDocumentClauses(
  documentId: string,
  query: string,
  limit = 5,
): Promise<ClauseHit[]> {
  const points = await hybridQuery(config.qdrant.collections.documentClauses, query, {
    filter: { must: [{ key: "documentId", match: { value: documentId } }] },
    limit,
  });
  return points.map((h) => {
    const p = (h.payload ?? {}) as Record<string, unknown>;
    return {
      clauseId: String(h.id),
      ordinal: Number(p.ordinal ?? 0),
      heading: (p.heading as string) ?? null,
      clauseType: (p.clauseType as string) ?? null,
      text: String(p.text ?? ""),
      score: h.score,
    };
  });
}

/**
 * Learning loop: store a human decision so future risk analyses of similar
 * clauses see how reviewers actually ruled.
 */
export async function rememberReviewDecision(entry: {
  id: string;
  documentId: string;
  clauseType: string | null;
  clauseText: string;
  action: string;
  fromValue?: unknown;
  toValue?: unknown;
  note?: string | null;
}) {
  const [vectors] = await buildVectors([entry.clauseText]);
  await qdrant().upsert(config.qdrant.collections.reviewMemory, {
    wait: true,
    points: [
      {
        id: entry.id,
        vector: vectors as never,
        payload: {
          documentId: entry.documentId,
          clauseType: entry.clauseType,
          action: entry.action,
          fromValue: JSON.stringify(entry.fromValue ?? null),
          toValue: JSON.stringify(entry.toValue ?? null),
          note: entry.note ?? null,
          text: entry.clauseText.slice(0, 500),
          at: new Date().toISOString(),
        },
      },
    ],
  });
}

export interface MemoryHit {
  action: string;
  clauseType: string | null;
  note: string | null;
  fromValue: string | null;
  toValue: string | null;
  text: string;
  score: number;
}

/** Retrieve prior human rulings on similar clauses (fed into risk prompts). */
export async function recallReviewDecisions(
  clauseText: string,
  clauseType?: string | null,
  limit = 3,
): Promise<MemoryHit[]> {
  const points = await hybridQuery(config.qdrant.collections.reviewMemory, clauseText.slice(0, 1000), {
    filter: clauseType
      ? { must: [{ key: "clauseType", match: { value: clauseType } }] }
      : undefined,
    limit,
  });
  return points
    .filter((h) => h.score > 0.01)
    .map((h) => {
      const p = (h.payload ?? {}) as Record<string, unknown>;
      return {
        action: String(p.action ?? ""),
        clauseType: (p.clauseType as string) ?? null,
        note: (p.note as string) ?? null,
        fromValue: (p.fromValue as string) ?? null,
        toValue: (p.toValue as string) ?? null,
        text: String(p.text ?? ""),
        score: h.score,
      };
    });
}

/** Remove a document's vectors (cleanup on delete/re-analyze). */
export async function deleteDocumentClauses(documentId: string) {
  await qdrant().delete(config.qdrant.collections.documentClauses, {
    wait: true,
    filter: { must: [{ key: "documentId", match: { value: documentId } }] },
  });
}

/** Collection stats for the observability dashboard. */
export async function collectionStats() {
  const client = qdrant();
  const names = Object.values(config.qdrant.collections);
  const stats: Record<string, { points: number; status: string }> = {};
  for (const name of names) {
    try {
      const info = await client.getCollection(name);
      stats[name] = { points: info.points_count ?? 0, status: info.status };
    } catch {
      stats[name] = { points: 0, status: "missing" };
    }
  }
  return stats;
}
