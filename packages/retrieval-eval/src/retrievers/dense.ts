/**
 * Dense semantic retrieval over locally-run sentence embeddings.
 *
 * Model: `Xenova/all-MiniLM-L6-v2` — an ONNX export of
 * `sentence-transformers/all-MiniLM-L6-v2`, Apache-2.0, 384 dimensions.
 * Runtime: `@huggingface/transformers` (Apache-2.0) on `onnxruntime-node` (MIT).
 *
 * Two RFP §3.6 constraints shaped this choice:
 *
 * 1. Every dependency must be permissively licensed and compatible with
 *    operating the code as a network service. Apache-2.0 / MIT throughout, and
 *    the model weights are Apache-2.0 rather than a bespoke "open weights"
 *    licence with use restrictions.
 * 2. No hosted model API. The embedder runs in-process, so the benchmark is
 *    reproducible without a network round trip or an API key, and a self-hoster
 *    inherits the same property.
 *
 * The model revision is pinned so a re-run reproduces the same vectors. Weights
 * are cached under `.models-cache/` on first run.
 */

import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import type { CatalogDocument, Retriever, ScoredHit } from "../types.js";
import { documentEmbeddingText } from "./text.js";

export const DENSE_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
/** Pinned so re-runs are reproducible. */
export const DENSE_MODEL_REVISION = "main";

env.cacheDir = process.env.MODELS_CACHE_DIR ?? ".models-cache";
env.allowLocalModels = true;

let sharedPipeline: Promise<FeatureExtractionPipeline> | undefined;

/** Loads the embedder once per process; the model is ~90MB on first run. */
function embedder(): Promise<FeatureExtractionPipeline> {
  sharedPipeline ??= pipeline("feature-extraction", DENSE_MODEL_ID, {
    revision: DENSE_MODEL_REVISION,
    dtype: "fp32",
  });
  return sharedPipeline;
}

/**
 * Embed texts with mean pooling and L2 normalisation.
 *
 * Normalising at embed time means cosine similarity is a plain dot product, so
 * query-time cost is one matrix pass and nothing else.
 */
export async function embed(texts: string[]): Promise<Float32Array[]> {
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
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

export class DenseRetriever implements Retriever {
  readonly name = "dense";
  readonly description = `Dense embeddings (${DENSE_MODEL_ID}, 384d, mean-pooled, cosine)`;

  private ids: string[] = [];
  private vectors: Float32Array[] = [];

  async index(corpus: CatalogDocument[]): Promise<void> {
    this.ids = corpus.map((d) => d.id);
    this.vectors = await embed(corpus.map(documentEmbeddingText));
  }

  async search(query: string, topK: number): Promise<ScoredHit[]> {
    if (this.ids.length === 0) return [];
    const [queryVector] = await embed([query]);
    const hits = this.ids.map((id, i) => ({
      id,
      score: cosine(queryVector!, this.vectors[i]!),
    }));
    hits.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1));
    return hits.slice(0, topK);
  }
}
