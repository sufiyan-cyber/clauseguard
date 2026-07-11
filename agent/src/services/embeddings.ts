/**
 * Local embedding service — zero-API-cost, runs fully on-device.
 *
 *  Dense:  BGE-small-en-v1.5 (384 dims) — semantic similarity
 *  Sparse: SPLADE++ (prithivida/Splade_PP_en_v1) — learned lexical expansion,
 *          the sparse leg of Qdrant hybrid search (RRF fusion server-side)
 *
 * ONNX models are downloaded to ./.fastembed-cache on first use. If the
 * sparse model is unavailable (offline first run), hybrid search degrades
 * gracefully to dense-only — a warning is logged, nothing breaks.
 */
import {
  EmbeddingModel,
  FlagEmbedding,
  SparseEmbeddingModel,
  SparseTextEmbedding,
  type SparseVector,
} from "fastembed";
import { config } from "../config";

const CACHE_DIR = config.embedCacheDir;

let densePromise: Promise<FlagEmbedding> | null = null;
let sparsePromise: Promise<SparseTextEmbedding | null> | null = null;

function getDense(): Promise<FlagEmbedding> {
  if (!densePromise) {
    densePromise = FlagEmbedding.init({
      model: EmbeddingModel.BGESmallENV15,
      cacheDir: CACHE_DIR,
      showDownloadProgress: false,
    });
  }
  return densePromise;
}

function getSparse(): Promise<SparseTextEmbedding | null> {
  // Small cloud volumes can't hold the ~500MB SPLADE model — set
  // DISABLE_SPARSE=1 to run dense-only (hybrid degrades gracefully).
  if (/^(1|true)$/i.test(process.env.DISABLE_SPARSE ?? "")) {
    return Promise.resolve(null);
  }
  if (!sparsePromise) {
    sparsePromise = SparseTextEmbedding.init({
      model: SparseEmbeddingModel.SpladePPEnV1,
      cacheDir: CACHE_DIR,
      showDownloadProgress: false,
    }).catch((err) => {
      console.warn(
        `[embeddings] SPLADE unavailable (${(err as Error).message}) — hybrid search degrades to dense-only`,
      );
      return null;
    });
  }
  return sparsePromise;
}

/** Dense-embed passages for indexing. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const embedder = await getDense();
  const out: number[][] = [];
  for await (const batch of embedder.passageEmbed(texts, 16)) {
    for (const vec of batch) out.push(Array.from(vec));
  }
  return out;
}

/** Dense-embed a query (asymmetric query prefix applied by the model). */
export async function embedQuery(text: string): Promise<number[]> {
  const embedder = await getDense();
  const vec = await embedder.queryEmbed(text);
  return Array.from(vec);
}

/** Sparse-embed passages (SPLADE). Returns null when sparse is unavailable. */
export async function embedSparseTexts(texts: string[]): Promise<SparseVector[] | null> {
  if (texts.length === 0) return [];
  const embedder = await getSparse();
  if (!embedder) return null;
  const out: SparseVector[] = [];
  for await (const batch of embedder.passageEmbed(texts, 8)) {
    for (const vec of batch) out.push(vec);
  }
  return out;
}

/** Sparse-embed a query (SPLADE). Returns null when sparse is unavailable. */
export async function embedSparseQuery(text: string): Promise<SparseVector | null> {
  const embedder = await getSparse();
  if (!embedder) return null;
  return embedder.queryEmbed(text);
}

export type { SparseVector };
