/**
 * Turns indexed chunks into the knowledge people actually browse: distilled
 * facts with evidence, and labelled themes. Pure orchestration over ports —
 * the extractor owns the prompts, the store owns the merge.
 *
 * Runs inside the indexer cycle, after the sources have written chunks, and is
 * budgeted per cycle so a large backlog drains over hours instead of spending
 * the model budget in one go.
 */
import { clusterCount, factKey, kmeans, representatives, validateDraft } from "../domain/knowledge.js";
import type {
  ConfigStore,
  Embedder,
  KbEvidence,
  KbFact,
  KbScope,
  KnowledgeExtractor,
  KnowledgeStore,
  Logger,
} from "../ports/outbound.js";

export interface KbSynthesisResult {
  chunksProcessed: number;
  factsCreated: number;
  factsUpdated: number;
  modelCalls: number;
  skipped: number;
  /** Batches that threw this run. Non-zero means the activity row shows an error. */
  errors: number;
  lastError?: string;
}

export interface KbTopicsResult {
  topics: number;
  modelCalls: number;
  refreshed: boolean;
}

export interface KbSynthesizerDeps {
  store: KnowledgeStore;
  embedder: Embedder;
  /** Late-bound: the console can change provider/model without a restart. */
  extractor: () => KnowledgeExtractor | null;
  config: ConfigStore;
  logger: Logger;
}

export interface KbSynthesizer {
  synthesize(scope: KbScope, userId: string, owner?: string): Promise<KbSynthesisResult>;
  refreshTopics(scope: KbScope, userId: string): Promise<KbTopicsResult>;
}

/**
 * A batch that fails three cycles running is consumed anyway. Without this, one
 * chunk the model always chokes on blocks every newer chunk behind it forever,
 * because the queue is newest-first.
 */
const MAX_BATCH_FAILURES = 3;

/**
 * ...but a misconfigured model fails on *every* batch, not one. That case needs
 * a counter that does not reset when the batch changes, or nothing ever trips:
 * each new lead chunk would look like a fresh first failure. After this many
 * failures in a row the principal stops for an hour, leaving the queue intact
 * and the reason visible in the activity log.
 */
const MAX_CONSECUTIVE_ERRORS = 6;
const HALT_MS = 60 * 60 * 1000;

interface Health {
  /** Lead chunk of the batch that failed, to spot the same batch failing again. */
  leadId: string;
  failures: number;
  /** Failures in a row across any batch — catches a broken model, not a bad batch. */
  consecutive: number;
  haltedUntil: number;
}

const snippet = (text: string): string => (text.length > 220 ? text.slice(0, 220) + "…" : text);

const emptyResult = (): KbSynthesisResult => ({
  chunksProcessed: 0,
  factsCreated: 0,
  factsUpdated: 0,
  modelCalls: 0,
  skipped: 0,
  errors: 0,
});

export function createKbSynthesizer(deps: KbSynthesizerDeps): KbSynthesizer {
  const { store, embedder, extractor, config, logger } = deps;
  const health = new Map<string, Health>();

  const healthOf = (principal: string): Health =>
    health.get(principal) ?? { leadId: "", failures: 0, consecutive: 0, haltedUntil: 0 };

  return {
    async synthesize(scope, userId, owner): Promise<KbSynthesisResult> {
      const ex = extractor();
      if (!ex) return { ...emptyResult(), skipped: 1 };

      const principal = scope + ":" + userId;
      const h = healthOf(principal);
      if (h.haltedUntil > Date.now()) {
        return {
          ...emptyResult(),
          skipped: 1,
          errors: 1,
          lastError: "distillation paused until " + new Date(h.haltedUntil).toISOString() + " after repeated failures",
        };
      }

      const batchSize = await config.getTyped<number>("kb.synthesisBatchSize", 24);
      const maxBatches = await config.getTyped<number>("kb.synthesisBatchesPerCycle", 2);

      const result = emptyResult();

      for (let b = 0; b < maxBatches; b++) {
        const chunks = await store.pendingSynthesis(scope, userId, batchSize);
        if (chunks.length === 0) break;
        const leadId = chunks[0]?.id ?? "";

        try {
          const drafts = await ex.extractFacts({
            scope,
            owner,
            chunks: chunks.map((c, idx) => ({ idx, source: c.source, ts: c.ts, text: c.text })),
          });
          result.modelCalls++;

          const usable = drafts.filter((d) => validateDraft(d, chunks.length));
          if (usable.length !== drafts.length) {
            logger.debug({ principal, dropped: drafts.length - usable.length }, "kb dropped malformed fact drafts");
          }

          const facts: Array<Omit<KbFact, "id" | "updatedAt" | "scope" | "userId">> = usable.map((d) => {
            const cited = d.evidenceIdx.map((i) => chunks[i]).filter((c): c is (typeof chunks)[number] => Boolean(c));
            const evidence: KbEvidence[] = cited.map((c) => ({
              chunkId: c.id,
              source: c.source,
              ts: c.ts,
              permalink: c.permalink,
              snippet: snippet(c.text),
            }));
            const times = cited.map((c) => c.ts);
            return {
              kind: d.kind,
              subject: d.subject.trim(),
              statement: d.statement.trim(),
              detail: d.detail?.trim() || undefined,
              key: factKey(d.subject, d.statement),
              confidence: d.confidence,
              firstSeenMs: times.length > 0 ? Math.min(...times) : Date.now(),
              lastSeenMs: times.length > 0 ? Math.max(...times) : Date.now(),
              evidence,
            };
          });

          if (facts.length > 0) {
            // Embed the claim as it reads, so fact search matches on meaning.
            const embeddings = await embedder.embedDocuments(
              facts.map((f) => [f.subject, f.statement, f.detail ?? ""].join(" — ").trim()),
            );
            const res = await store.upsertFacts(scope, userId, facts, embeddings);
            result.factsCreated += res.created;
            result.factsUpdated += res.updated;
          }

          await store.markSynthesized(chunks.map((c) => c.id));
          result.chunksProcessed += chunks.length;
          health.delete(principal);
        } catch (err) {
          const message = (err as Error).message;
          result.errors++;
          result.lastError = message;

          const prev = healthOf(principal);
          const failures = prev.leadId === leadId ? prev.failures + 1 : 1;
          const consecutive = prev.consecutive + 1;
          const next: Health = { leadId, failures, consecutive, haltedUntil: 0 };
          logger.warn({ principal, attempt: failures, err: message }, "kb synthesis batch failed");

          // This particular batch is the problem — drop it and let the rest through.
          if (failures >= MAX_BATCH_FAILURES) {
            await store.markSynthesized(chunks.map((c) => c.id));
            next.failures = 0;
            logger.warn({ principal, chunks: chunks.length }, "kb synthesis batch skipped after repeated failures");
          }

          // Nothing is getting through at all — back off instead of grinding
          // the whole queue against a model that cannot answer.
          if (consecutive >= MAX_CONSECUTIVE_ERRORS) {
            next.consecutive = 0;
            next.haltedUntil = Date.now() + HALT_MS;
            result.lastError = "distillation halted for an hour — " + message;
            logger.error({ principal, err: message }, "kb synthesis halted: the model keeps failing");
          }

          health.set(principal, next);
          break;
        }
      }

      return result;
    },

    async refreshTopics(scope, userId): Promise<KbTopicsResult> {
      const ex = extractor();
      if (!ex) return { topics: 0, modelCalls: 0, refreshed: false };
      if (healthOf(scope + ":" + userId).haltedUntil > Date.now()) {
        return { topics: 0, modelCalls: 0, refreshed: false };
      }

      const everyHours = await config.getTyped<number>("kb.topicRefreshHours", 6);
      const cursor = await store.getCursor(scope, userId, "synthesis", "topics");
      const lastAt = typeof cursor?.at === "number" ? cursor.at : 0;
      if (Date.now() - lastAt < everyHours * 3_600_000) return { topics: 0, modelCalls: 0, refreshed: false };

      const sampleSize = await config.getTyped<number>("kb.topicSampleSize", 1500);
      const rows = await store.embeddingsForClustering(scope, userId, sampleSize);
      if (rows.length < 8) {
        await store.setCursor(scope, userId, "synthesis", "topics", { at: Date.now() });
        return { topics: 0, modelCalls: 0, refreshed: true };
      }

      const vectors = rows.map((r) => r.embedding);
      const clusters = kmeans(vectors, clusterCount(rows.length));

      let calls = 0;
      const drafts = [];
      for (const cluster of clusters) {
        // Too small to be a theme — its chunks stay unassigned rather than
        // padding the list with singletons.
        if (cluster.members.length < 3) continue;
        const samples = representatives(vectors, cluster, 6).map((i) => snippet(rows[i]?.text ?? ""));
        try {
          const { label, summary } = await ex.labelTopic({ scope, samples });
          calls++;
          drafts.push({
            label,
            summary,
            chunkIds: cluster.members.map((i) => rows[i]?.id ?? "").filter(Boolean),
          });
        } catch (err) {
          logger.warn({ scope, userId, err: (err as Error).message }, "kb topic labelling failed");
        }
      }

      // Only replace when something was actually labelled — a total model
      // outage must not wipe the themes that are already there.
      if (drafts.length === 0 && clusters.length > 0) {
        return { topics: 0, modelCalls: calls, refreshed: false };
      }

      await store.replaceTopics(scope, userId, drafts);
      await store.setCursor(scope, userId, "synthesis", "topics", { at: Date.now() });
      return { topics: drafts.length, modelCalls: calls, refreshed: true };
    },
  };
}
