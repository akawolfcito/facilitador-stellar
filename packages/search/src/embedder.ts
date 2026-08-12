/**
 * Sentence embeddings, run in-process.
 *
 * Model: `Xenova/all-MiniLM-L6-v2` — ONNX export of
 * `sentence-transformers/all-MiniLM-L6-v2`, Apache-2.0, 384 dimensions.
 * Runtime: `@huggingface/transformers` (Apache-2.0) on `onnxruntime-node` (MIT).
 *
 * No hosted model API. RFP §3.6 requires every dependency to be permissively
 * licensed and compatible with operating the code as a network service, and a
 * self-hoster inheriting an API key requirement would fail that. It also keeps
 * the benchmark reproducible offline after the first run.
 *
 * This module is the single embedder for both the benchmark and the live
 * `/discovery/search`. There is no second copy to drift from.
 */

import { createHash } from "node:crypto";
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_REVISION = "main";
export const EMBEDDING_DIMS = 384;

env.cacheDir = process.env.MODELS_CACHE_DIR ?? ".models-cache";
env.allowLocalModels = true;

let sharedPipeline: Promise<FeatureExtractionPipeline> | undefined;

/** Loads the embedder once per process. ~90MB on first run, then cached. */
function embedder(): Promise<FeatureExtractionPipeline> {
  sharedPipeline ??= pipeline("feature-extraction", EMBEDDING_MODEL, {
    revision: EMBEDDING_REVISION,
    dtype: "fp32",
  });
  return sharedPipeline;
}

/**
 * Embed texts with mean pooling and L2 normalisation.
 *
 * Normalising at embed time makes cosine similarity a plain dot product, so
 * query-time cost is one pass and no per-vector division.
 */
export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const extract = await embedder();
  const output = await extract(texts, { pooling: "mean", normalize: true });
  const [rows, dims] = output.dims as [number, number];
  const data = output.data as Float32Array;
  const vectors: Float32Array[] = [];
  for (let i = 0; i < rows; i++) {
    vectors.push(data.slice(i * dims, (i + 1) * dims));
  }
  return vectors;
}

/** Dot product of two equal-length, already-normalised vectors. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

/** Freshness key for a cached embedding. */
export function documentHash(document: string): string {
  return createHash("sha256").update(document, "utf8").digest("hex").slice(0, 32);
}
