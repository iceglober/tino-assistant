/**
 * Embedder adapters, and which one an org gets.
 *
 * Every embedder produces 3072-dim, L2-normalized vectors (the KB's halfvec
 * width): OpenAI/Azure text-embedding-3-large natively, Vertex
 * gemini-embedding-001 at full size. Vectors are normalized defensively —
 * ranking correctness must not depend on a provider's documentation.
 *
 * An org's knowledge base embeds with the org's own key when it has one
 * (OpenAI, or an Azure embedding deployment), else with the platform's
 * embedder if the operator configured one, else not at all. Which model wrote
 * an org's vectors is pinned in `kb.embedModel`: vectors from two models
 * aren't comparable, so a change means rebuilding, never mixing.
 */
import { createAzure } from "@ai-sdk/azure";
import { createVertex } from "@ai-sdk/google-vertex";
import { createOpenAI } from "@ai-sdk/openai";
import { embed, embedMany, type EmbeddingModel } from "ai";
import type { Embedder } from "@tino/core/ports/outbound";
import { KB_EMBED_DIMS } from "./schema.js";

const EMBED_MODEL_ID = "gemini-embedding-001";
const OPENAI_EMBED_MODEL = "text-embedding-3-large";
const BATCH = 100;

/** An embedder plus the id recorded on what it writes. */
export interface NamedEmbedder extends Embedder {
  model: string;
}

export function l2Normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0 || !Number.isFinite(norm)) return v;
  return v.map((x) => x / norm);
}

export function createVertexEmbedder(opts: { project?: string; location?: string } = {}): NamedEmbedder {
  // Lazy: the SDK validates project/location at model construction and would
  // otherwise crash boot on installs without Vertex configured.
  let model: ReturnType<ReturnType<typeof createVertex>["textEmbeddingModel"]> | null = null;
  const getModel = () => {
    if (!model) {
      const vertex = createVertex({
        ...(opts.project ? { project: opts.project } : {}),
        ...(opts.location ? { location: opts.location } : {}),
      });
      model = vertex.textEmbeddingModel(EMBED_MODEL_ID);
    }
    return model;
  };

  return {
    model: `vertex:${EMBED_MODEL_ID}@${KB_EMBED_DIMS}`,
    async embedDocuments(texts: string[]): Promise<number[][]> {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH);
        const { embeddings } = await embedMany({
          model: getModel(),
          values: batch,
          providerOptions: { google: { taskType: "RETRIEVAL_DOCUMENT", autoTruncate: true } },
        });
        for (const e of embeddings) out.push(l2Normalize(e as number[]));
      }
      return out;
    },

    async embedQuery(text: string): Promise<number[]> {
      const { embedding } = await embed({
        model: getModel(),
        value: text,
        providerOptions: { google: { taskType: "RETRIEVAL_QUERY", autoTruncate: true } },
      });
      return l2Normalize(embedding as number[]);
    },
  };
}

/** OpenAI-compatible text-embedding-3-large (OpenAI or an Azure deployment of it). */
function createOpenAiCompatibleEmbedder(model: EmbeddingModel, id: string): NamedEmbedder {
  const options = { openai: { dimensions: KB_EMBED_DIMS } };
  return {
    model: id,
    async embedDocuments(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const { embeddings } = await embedMany({ model, values: texts.slice(i, i + BATCH), providerOptions: options });
        for (const e of embeddings) out.push(l2Normalize(e as number[]));
      }
      return out;
    },
    async embedQuery(text) {
      const { embedding } = await embed({ model, value: text, providerOptions: options });
      return l2Normalize(embedding as number[]);
    },
  };
}

export function createOpenAiEmbedder(apiKey: string): NamedEmbedder {
  return createOpenAiCompatibleEmbedder(
    createOpenAI({ apiKey }).embedding(OPENAI_EMBED_MODEL),
    `openai:${OPENAI_EMBED_MODEL}@${KB_EMBED_DIMS}`,
  );
}

export function createAzureEmbedder(opts: {
  apiKey: string;
  deployment: string;
  resourceName?: string;
  baseURL?: string;
}): NamedEmbedder {
  const azure = createAzure({ apiKey: opts.apiKey, resourceName: opts.resourceName, baseURL: opts.baseURL });
  return createOpenAiCompatibleEmbedder(azure.embedding(opts.deployment), `azure:${opts.deployment}@${KB_EMBED_DIMS}`);
}

/**
 * The embedder for an org: its own key first, then the platform's. `get` reads
 * the org's settings. Returns null with the reason to show when there is none.
 */
export function resolveEmbedder(
  get: (key: string) => string | undefined,
  platform: NamedEmbedder | null,
): { embedder: NamedEmbedder } | { embedder: null; reason: string } {
  const openaiKey = get("openai.apiKey");
  if (openaiKey) return { embedder: createOpenAiEmbedder(openaiKey) };
  const azureKey = get("azure.apiKey");
  const azureDeployment = get("azure.embeddingDeployment");
  if (azureKey && azureDeployment && (get("azure.resourceName") || get("azure.baseURL"))) {
    return {
      embedder: createAzureEmbedder({
        apiKey: azureKey,
        deployment: azureDeployment,
        resourceName: get("azure.resourceName"),
        baseURL: get("azure.baseURL"),
      }),
    };
  }
  if (platform) return { embedder: platform };
  return {
    embedder: null,
    reason:
      "the knowledge base needs an embedding model — add an OpenAI API key, or an Azure text-embedding-3-large deployment, in Settings → Model",
  };
}

/**
 * Deterministic fake embedder (tests + keyless local dev): hashes character
 * trigrams into a fixed-dim bag, L2-normalized — similar texts get similar
 * vectors, and results are stable across runs.
 */
export function createFakeEmbedder(dims: number = KB_EMBED_DIMS): NamedEmbedder {
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
    model: `fake@${dims}`,
    embedDocuments: async (texts) => texts.map(embedOne),
    embedQuery: async (text) => embedOne(text),
  };
}
