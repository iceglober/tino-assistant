/**
 * The KB indexer use-case: a single in-process loop that discovers principals
 * (workspace bot + each connected user × source), gives each a budgeted slice
 * of work per cycle, and isolates failures so one revoked token never stalls
 * the rest. Pure orchestration over ports — sources do the API work.
 *
 * Each cycle has two stages: sources write raw chunks, then the synthesizer
 * distills whatever is pending into facts and themes. Both stages emit one
 * activity row per principal so the console can show what actually happened
 * rather than just a total.
 */
import type { KbSynthesizer } from "./kb-synthesizer.js";
import type {
  ConfigStore,
  KbCycleEvent,
  KbIndexState,
  KbScope,
  KnowledgeStore,
  Logger,
  UserCapabilityStore,
  UserStore,
} from "../ports/outbound.js";

export interface KbPrincipal {
  scope: KbScope;
  userId: string; // '' for workspace
  source: "slack" | "gmail";
}

export interface KbRunResult {
  chunksUpserted: number;
  apiCalls: number;
  backfillDone: boolean;
  /** One line for the activity timeline, e.g. "45/45 channels, 12 api calls". */
  detail?: string;
}

/** One budgeted slice of indexing for a principal. Throws KbAuthError on revoked creds. */
export type KbSourceRunner = (principal: KbPrincipal, backfillDone: boolean) => Promise<KbRunResult>;

export class KbAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KbAuthError";
  }
}

export interface KbIndexerDeps {
  store: KnowledgeStore;
  users: UserStore;
  userCapabilities: UserCapabilityStore;
  config: ConfigStore;
  logger: Logger;
  runners: { slackWorkspace: KbSourceRunner; slackPersonal: KbSourceRunner; gmail: KbSourceRunner };
  /** Optional: distillation stage. Without it the KB stays raw chunks only. */
  synthesizer?: KbSynthesizer;
  /** Optional: tell a user their connection broke (wired to a Slack DM). */
  notifyAuthLoss?: (userId: string, source: "slack" | "gmail") => Promise<void>;
  intervalMs?: number;
}

const PAUSED_ERROR_RETRY_MS = 30 * 60 * 1000;

/** What the last completed cycle did — surfaced in the console. */
export interface KbCycleSummary {
  at: number;
  cycleId: string;
  principals: number;
  skipped: number;
  chunksUpserted: number;
  apiCalls: number;
  errors: number;
  factsCreated: number;
  factsUpdated: number;
  chunksDistilled: number;
  ms: number;
}

export interface KbIndexerStatus {
  running: boolean;
  intervalMs: number;
  startedAt?: number;
  /** Epoch ms of the next scheduled tick (approximate). */
  nextRunAt?: number;
  lastCycle?: KbCycleSummary;
  cyclesCompleted: number;
}

export interface KbIndexer {
  start(): void;
  stop(): void;
  /** Run one full cycle now (tests + manual kick). */
  runCycleOnce(): Promise<void>;
  status(): KbIndexerStatus;
}

export function createKbIndexer(deps: KbIndexerDeps): KbIndexer {
  const { store, users, userCapabilities, config, logger, runners, synthesizer, notifyAuthLoss } = deps;
  const intervalMs = deps.intervalMs ?? 5 * 60 * 1000;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let offset = 0; // rotates so no principal starves
  let synthOffset = 0;
  let startedAt: number | undefined;
  let lastTickAt: number | undefined;
  let lastCycle: KbCycleSummary | undefined;
  let cyclesCompleted = 0;

  async function discoverPrincipals(): Promise<KbPrincipal[]> {
    const principals: KbPrincipal[] = [];
    const botToken = await config.get("slack.botToken");
    if (botToken) principals.push({ scope: "workspace", userId: "", source: "slack" });

    for (const user of await users.list()) {
      if (user.status !== "active") continue;
      const caps = await userCapabilities.list(user.id);
      if (caps.some((c) => c.capabilityId === "slack" && c.enabled)) {
        principals.push({ scope: "private", userId: user.id, source: "slack" });
      }
      if (caps.some((c) => c.capabilityId === "gmail" && c.enabled)) {
        principals.push({ scope: "private", userId: user.id, source: "gmail" });
      }
    }
    return principals;
  }

  function runnerFor(p: KbPrincipal): KbSourceRunner {
    if (p.source === "gmail") return runners.gmail;
    return p.scope === "workspace" ? runners.slackWorkspace : runners.slackPersonal;
  }

  async function runPrincipal(
    p: KbPrincipal,
  ): Promise<Partial<KbRunResult> & { skipped?: boolean; error?: string; authError?: boolean }> {
    const existing = await store.getIndexState(p.scope, p.userId, p.source);
    if (existing?.status === "disabled" || existing?.status === "paused_auth") return { skipped: true };
    if (
      existing?.status === "paused_error" &&
      existing.pausedAt !== undefined &&
      Date.now() - existing.pausedAt < PAUSED_ERROR_RETRY_MS
    ) {
      return { skipped: true };
    }

    const base: KbIndexState = {
      scope: p.scope,
      userId: p.userId,
      source: p.source,
      status: "active",
      backfillDone: existing?.backfillDone ?? false,
    };

    try {
      const result = await runnerFor(p)(p, base.backfillDone);
      await store.setIndexState({ ...base, backfillDone: result.backfillDone, lastCycleAt: Date.now() });
      return result;
    } catch (err) {
      const msg = (err as Error).message;
      if (err instanceof KbAuthError) {
        await store.setIndexState({ ...base, status: "paused_auth", pausedAt: Date.now(), lastError: msg });
        logger.warn({ ...p, err: msg }, "kb principal paused (auth)");
        if (p.scope === "private" && notifyAuthLoss) await notifyAuthLoss(p.userId, p.source).catch(() => {});
        return { error: msg, authError: true };
      }
      await store.setIndexState({ ...base, status: "paused_error", pausedAt: Date.now(), lastError: msg });
      logger.warn({ ...p, err: msg }, "kb principal paused (error, will retry)");
      return { error: msg };
    }
  }

  /** Who has content worth distilling: the shared workspace plus active users. */
  async function synthesisPrincipals(): Promise<Array<{ scope: KbScope; userId: string; owner?: string }>> {
    const list: Array<{ scope: KbScope; userId: string; owner?: string }> = [
      { scope: "workspace", userId: "" },
    ];
    for (const user of await users.list()) {
      if (user.status !== "active") continue;
      list.push({ scope: "private", userId: user.id, owner: user.name ?? user.email });
    }
    return list;
  }

  async function cycle(): Promise<void> {
    if (running) {
      logger.debug("kb cycle skipped (still running)");
      return;
    }
    running = true;
    const start = Date.now();
    const cycleId = String(start);
    lastTickAt = start;
    const events: Array<Omit<KbCycleEvent, "id">> = [];

    try {
      const principals = await discoverPrincipals();

      let chunks = 0;
      let calls = 0;
      let errors = 0;
      let skipped = 0;

      if (principals.length > 0) {
        const rot = offset % principals.length;
        const rotated = principals.slice(rot).concat(principals.slice(0, rot));
        offset++;

        for (const p of rotated) {
          const t0 = Date.now();
          const r = await runPrincipal(p);
          chunks += r.chunksUpserted ?? 0;
          calls += r.apiCalls ?? 0;
          if (r.error) errors++;
          if (r.skipped) skipped++;
          events.push({
            cycleId,
            at: t0,
            scope: p.scope,
            userId: p.userId,
            source: p.source,
            outcome: r.skipped ? "skipped" : r.authError ? "auth_error" : r.error ? "error" : "ok",
            chunksUpserted: r.chunksUpserted ?? 0,
            apiCalls: r.apiCalls ?? 0,
            ms: Date.now() - t0,
            detail: r.detail,
            error: r.error,
          });
        }
      }

      // ── Distillation ──────────────────────────────────────────────────────
      let factsCreated = 0;
      let factsUpdated = 0;
      let distilled = 0;
      if (synthesizer) {
        const all = await synthesisPrincipals();
        const perCycle = await config.getTyped<number>("kb.synthesisPrincipalsPerCycle", 3);
        const rot = all.length > 0 ? synthOffset % all.length : 0;
        const ordered = all.slice(rot).concat(all.slice(0, rot)).slice(0, Math.max(1, perCycle));
        synthOffset++;

        for (const sp of ordered) {
          const t0 = Date.now();
          try {
            const res = await synthesizer.synthesize(sp.scope, sp.userId, sp.owner);
            const topics = await synthesizer.refreshTopics(sp.scope, sp.userId);
            factsCreated += res.factsCreated;
            factsUpdated += res.factsUpdated;
            distilled += res.chunksProcessed;
            if (res.errors > 0) errors++;
            if (res.chunksProcessed > 0 || res.modelCalls > 0 || res.errors > 0) {
              events.push({
                cycleId,
                at: t0,
                scope: sp.scope,
                userId: sp.userId,
                source: "synthesis",
                outcome: res.errors > 0 ? "error" : "ok",
                chunksUpserted: 0,
                apiCalls: res.modelCalls,
                ms: Date.now() - t0,
                detail: `${res.chunksProcessed} chunks read → ${res.factsCreated} new, ${res.factsUpdated} updated`,
                error: res.lastError,
              });
            }
            if (topics.refreshed) {
              events.push({
                cycleId,
                at: Date.now(),
                scope: sp.scope,
                userId: sp.userId,
                source: "topics",
                outcome: "ok",
                chunksUpserted: 0,
                apiCalls: topics.modelCalls,
                ms: 0,
                detail: `${topics.topics} themes rebuilt`,
              });
            }
          } catch (err) {
            errors++;
            logger.warn({ ...sp, err: (err as Error).message }, "kb synthesis failed");
            events.push({
              cycleId,
              at: t0,
              scope: sp.scope,
              userId: sp.userId,
              source: "synthesis",
              outcome: "error",
              chunksUpserted: 0,
              apiCalls: 0,
              ms: Date.now() - t0,
              error: (err as Error).message,
            });
          }
        }
      }

      lastCycle = {
        at: start,
        cycleId,
        principals: principals.length,
        skipped,
        chunksUpserted: chunks,
        apiCalls: calls,
        errors,
        factsCreated,
        factsUpdated,
        chunksDistilled: distilled,
        ms: Date.now() - start,
      };
      cyclesCompleted++;
      // Activity rows are diagnostics — never let them fail a cycle.
      await store.recordCycleEvents(events).catch((err: Error) => {
        logger.warn({ err: err.message }, "kb activity log write failed");
      });
      logger.info({ ...lastCycle }, "kb cycle complete");
    } catch (err) {
      logger.error({ err: (err as Error).message }, "kb cycle failed");
    } finally {
      running = false;
    }
  }

  return {
    start(): void {
      if (timer) return;
      timer = setInterval(() => void cycle(), intervalMs);
      timer.unref?.();
      startedAt = Date.now();
      // First cycle shortly after boot (don't block startup).
      setTimeout(() => void cycle(), 15_000).unref?.();
      logger.info({ intervalMs }, "kb indexer started");
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
      startedAt = undefined;
    },
    runCycleOnce: cycle,
    status(): KbIndexerStatus {
      return {
        running,
        intervalMs,
        startedAt,
        nextRunAt: timer && lastTickAt ? lastTickAt + intervalMs : undefined,
        lastCycle,
        cyclesCompleted,
      };
    },
  };
}
