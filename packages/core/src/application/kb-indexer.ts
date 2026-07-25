/**
 * The KB indexer use-case: a single in-process loop that discovers principals
 * (workspace bot + each connected user × source), gives each a budgeted slice
 * of work per cycle, and isolates failures so one revoked token never stalls
 * the rest. Pure orchestration over ports — sources do the API work.
 */
import type {
  ConfigStore,
  KbIndexState,
  KnowledgeStore,
  Logger,
  UserCapabilityStore,
  UserStore,
} from "../ports/outbound.js";

export interface KbPrincipal {
  scope: "workspace" | "user";
  userId: string; // '' for workspace
  source: "slack" | "gmail";
}

export interface KbRunResult {
  chunksUpserted: number;
  apiCalls: number;
  backfillDone: boolean;
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
  /** Optional: tell a user their connection broke (wired to a Slack DM). */
  notifyAuthLoss?: (userId: string, source: "slack" | "gmail") => Promise<void>;
  intervalMs?: number;
}

const PAUSED_ERROR_RETRY_MS = 30 * 60 * 1000;

export interface KbIndexer {
  start(): void;
  stop(): void;
  /** Run one full cycle now (tests + manual kick). */
  runCycleOnce(): Promise<void>;
}

export function createKbIndexer(deps: KbIndexerDeps): KbIndexer {
  const { store, users, userCapabilities, config, logger, runners, notifyAuthLoss } = deps;
  const intervalMs = deps.intervalMs ?? 5 * 60 * 1000;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let offset = 0; // rotates so no principal starves

  async function discoverPrincipals(): Promise<KbPrincipal[]> {
    const principals: KbPrincipal[] = [];
    const botToken = await config.get("slack.botToken");
    if (botToken) principals.push({ scope: "workspace", userId: "", source: "slack" });

    for (const user of await users.list()) {
      if (user.status !== "active") continue;
      const caps = await userCapabilities.list(user.id);
      if (caps.some((c) => c.capabilityId === "slack" && c.enabled)) {
        principals.push({ scope: "user", userId: user.id, source: "slack" });
      }
      if (caps.some((c) => c.capabilityId === "gmail" && c.enabled)) {
        principals.push({ scope: "user", userId: user.id, source: "gmail" });
      }
    }
    return principals;
  }

  function runnerFor(p: KbPrincipal): KbSourceRunner {
    if (p.source === "gmail") return runners.gmail;
    return p.scope === "workspace" ? runners.slackWorkspace : runners.slackPersonal;
  }

  async function runPrincipal(p: KbPrincipal): Promise<Partial<KbRunResult> & { skipped?: boolean; error?: string }> {
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
        if (p.scope === "user" && notifyAuthLoss) await notifyAuthLoss(p.userId, p.source).catch(() => {});
      } else {
        await store.setIndexState({ ...base, status: "paused_error", pausedAt: Date.now(), lastError: msg });
        logger.warn({ ...p, err: msg }, "kb principal paused (error, will retry)");
      }
      return { error: msg };
    }
  }

  async function cycle(): Promise<void> {
    if (running) {
      logger.debug("kb cycle skipped (still running)");
      return;
    }
    running = true;
    const start = Date.now();
    try {
      const principals = await discoverPrincipals();
      if (principals.length === 0) return;

      const rotated = principals.slice(offset % principals.length).concat(principals.slice(0, offset % principals.length));
      offset++;

      let chunks = 0;
      let calls = 0;
      let errors = 0;
      let skipped = 0;
      for (const p of rotated) {
        const r = await runPrincipal(p);
        chunks += r.chunksUpserted ?? 0;
        calls += r.apiCalls ?? 0;
        if (r.error) errors++;
        if (r.skipped) skipped++;
      }
      logger.info(
        { principals: principals.length, skipped, chunksUpserted: chunks, apiCalls: calls, errors, ms: Date.now() - start },
        "kb cycle complete",
      );
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
      // First cycle shortly after boot (don't block startup).
      setTimeout(() => void cycle(), 15_000).unref?.();
      logger.info({ intervalMs }, "kb indexer started");
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
    runCycleOnce: cycle,
  };
}
