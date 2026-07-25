/**
 * Vertex AI adapter for the Embedder port — gemini-embedding-001 at full
 * 3072 dims via ADC (Workload Identity on GKE; `gcloud auth
 * application-default login` locally). Asymmetric retrieval: documents are
 * embedded as RETRIEVAL_DOCUMENT, queries as RETRIEVAL_QUERY.
 *
 * Vectors are L2-normalized defensively (the full 3072 output is documented
 * as pre-normalized, but ranking correctness must not depend on that).
 */
import { createVertex } from "@ai-sdk/google-vertex";
import { embed, embedMany } from "ai";
import type { Embedder } from "../../../ports/outbound.js";
import { KB_EMBED_DIMS } from "./schema.js";

const EMBED_MODEL_ID = "gemini-embedding-001";
const BATCH = 100;

export function l2Normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0 || !Number.isFinite(norm)) return v;
  return v.map((x) => x / norm);
}

export function createVertexEmbedder(opts: { project?: string; location?: string } = {}): Embedder {
  const vertex = createVertex({
    ...(opts.project ? { project: opts.project } : {}),
    ...(opts.location ? { location: opts.location } : {}),
  });
  const model = vertex.textEmbeddingModel(EMBED_MODEL_ID);

  return {
    async embedDocuments(texts: string[]): Promise<number[][]> {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH);
        const { embeddings } = await embedMany({
          model,
          values: batch,
          providerOptions: { google: { taskType: "RETRIEVAL_DOCUMENT", autoTruncate: true } },
        });
        for (const e of embeddings) out.push(l2Normalize(e as number[]));
      }
      return out;
    },

    async embedQuery(text: string): Promise<number[]> {
      const { embedding } = await embed({
        model,
        value: text,
        providerOptions: { google: { taskType: "RETRIEVAL_QUERY", autoTruncate: true } },
      });
      return l2Normalize(embedding as number[]);
    },
  };
}

/**
 * Deterministic fake embedder (tests + keyless local dev): hashes character
 * trigrams into a fixed-dim bag, L2-normalized — similar texts get similar
 * vectors, and results are stable across runs.
 */
export function createFakeEmbedder(dims: number = KB_EMBED_DIMS): Embedder {
  const embedOne = (text: string): number[] => {
    const v = new Array<number>(dims).fill(0);
    const s = text.toLowerCase();
    for (let i = 0; i < s.length - 2; i++) {
      let h = 2166136261;
      for (let j = i; j < i + 3; j++) {
        h ^= s.charCodeAt(j);
        h = Math.imul(h, 16777619);
      }
      const idx = Math.abs(h) % dims;
      v[idx] = (v[idx] ?? 0) + 1;
    }
    return l2Normalize(v);
  };
  return {
    embedDocuments: async (texts) => texts.map(embedOne),
    embedQuery: async (text) => embedOne(text),
  };
}
