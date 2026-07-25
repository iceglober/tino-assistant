/**
 * Slack KB source — shared engine for the workspace principal (bot token,
 * public channels) and per-user principals (xoxp; DMs, group DMs, private
 * channels). Per cycle and per principal, within a Web-API call budget:
 *   discovery (users.conversations) → per-channel steady-state advance from
 *   the cursor → active-thread re-rollups → backfill (newest→oldest to the
 *   horizon). Cursor state lives in kb_cursors; upserts are content-hash
 *   idempotent so overlaps are free.
 */
import { webApi } from "@slack/bolt";
import { rollupThread, type SlackKbMessage, slackTsToMs, windowMessages } from "../../../../domain/kb.js";
import { KbAuthError, type KbPrincipal, type KbRunResult } from "../../../../application/kb-indexer.js";
import type { ConfigStore, Embedder, KbChunk, KnowledgeStore, Logger, UserCapabilityStore } from "../../../../ports/outbound.js";
import { readUserCredentials } from "../../tools/credentials.js";

interface SlackCursor {
  latest?: string; // newest ts fully indexed (steady-state floor)
  backfillOldest?: string; // how far back the backfill has walked
  backfillDone?: boolean;
  activeThreads?: Record<string, string>; // threadTs -> last indexed reply ts
  [key: string]: unknown;
}

interface SlackSourceDeps {
  store: KnowledgeStore;
  embedder: Embedder;
  config: ConfigStore;
  userCapabilities: UserCapabilityStore;
  logger: Logger;
  backfillDays?: number;
  callBudget?: number;
}

const AUTH_ERRORS = new Set(["not_authed", "invalid_auth", "token_revoked", "account_inactive"]);
const ACTIVE_THREAD_CAP = 50;
const ACTIVE_THREAD_IDLE_MS = 14 * 86_400_000;

function isAuthError(err: unknown): boolean {
  const code = (err as { data?: { error?: string } }).data?.error ?? "";
  return AUTH_ERRORS.has(code);
}

const parseJson = (raw: string | null): string | undefined => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw;
  }
};

export function createSlackKbSource(deps: SlackSourceDeps, mode: "workspace" | "personal") {
  const { store, embedder, config, userCapabilities, logger } = deps;
  const backfillDays = deps.backfillDays ?? 90;
  const callBudget = deps.callBudget ?? 30;

  return async (principal: KbPrincipal, _backfillDone: boolean): Promise<KbRunResult> => {
    // ── Token ────────────────────────────────────────────────────────────────
    let token: string | undefined;
    if (mode === "workspace") {
      token = parseJson(await config.get("slack.botToken"));
    } else {
      const cap = await readUserCredentials(principal.userId, "slack", config, userCapabilities);
      token = cap?.credentials?.userToken;
    }
    if (!token) throw new KbAuthError(`no slack token for ${mode} principal`);

    const client = new webApi.WebClient(token);
    let calls = 0;
    const call = async <T>(fn: () => Promise<T>): Promise<T> => {
      calls++;
      try {
        return await fn();
      } catch (err) {
        if (isAuthError(err)) throw new KbAuthError((err as Error).message);
        throw err;
      }
    };

    const horizonMs = Date.now() - backfillDays * 86_400_000;
    const horizonTs = String(Math.floor(horizonMs / 1000));
    let chunksUpserted = 0;
    let allBackfillDone = true;

    // Team URL for permalinks (1 call, reused for every chunk this cycle).
    const auth = await call(() => client.auth.test());
    const teamUrl = ((auth as { url?: string }).url ?? "").replace(/\/$/, "");
    const permalink = (channel: string, ts: string): string =>
      teamUrl ? `${teamUrl}/archives/${channel}/p${ts.replace(".", "")}` : "";

    // ── Discovery ───────────────────────────────────────────────────────────
    const types = mode === "workspace" ? "public_channel" : "im,mpim,private_channel";
    const convs = await call(() =>
      client.users.conversations({ types, limit: 200, exclude_archived: true }),
    );
    const channels = (convs.channels ?? []) as Array<{
      id?: string;
      name?: string;
      is_im?: boolean;
      is_mpim?: boolean;
      user?: string;
    }>;

    const source: KbChunk["source"] =
      mode === "workspace" ? "slack_channel" : "slack_dm";
    const label = (ch: (typeof channels)[number]): string =>
      ch.is_im ? `DM ${ch.user ?? ch.id}` : ch.is_mpim ? `group DM ${ch.name ?? ch.id}` : `#${ch.name ?? ch.id}`;

    const upsert = async (chunks: KbChunk[]): Promise<void> => {
      if (chunks.length === 0) return;
      const embeddings = await embedder.embedDocuments(chunks.map((c) => c.text));
      chunksUpserted += await store.upsertChunks(chunks, embeddings);
    };

    const toKb = (msgs: Array<{ ts?: string; user?: string; text?: string }>): SlackKbMessage[] =>
      msgs
        .filter((m) => m.ts && typeof m.text === "string" && m.text.length > 0)
        .map((m) => ({ ts: m.ts as string, author: m.user ?? "unknown", text: m.text as string }));

    // ── Per channel ─────────────────────────────────────────────────────────
    for (const ch of channels) {
      if (!ch.id) continue;
      if (calls >= callBudget) {
        allBackfillDone = false;
        break;
      }
      const channelId = ch.id;
      const cursor: SlackCursor =
        ((await store.getCursor(principal.scope, principal.userId, "slack", channelId)) as SlackCursor | null) ?? {};
      const active: Record<string, string> = { ...(cursor.activeThreads ?? {}) };

      const processPage = async (msgs: Array<Record<string, unknown>>): Promise<void> => {
        const parents = msgs.filter((m) => typeof m.thread_ts === "string" && m.thread_ts === m.ts);
        for (const p of parents) active[p.ts as string] = (active[p.ts as string] as string | undefined) ?? "0";
        const standalone = msgs.filter((m) => m.thread_ts === undefined && m.subtype === undefined);
        const windows = windowMessages({ channelLabel: label(ch), messages: toKb(standalone as never) });
        await upsert(
          windows.map((wnd) => ({
            scope: principal.scope,
            userId: principal.userId,
            source,
            sourceRef: `${channelId}:win:${wnd.refTs}`,
            chunkSeq: 0,
            text: wnd.text,
            ts: wnd.tsMs,
            permalink: permalink(channelId, wnd.refTs),
            meta: { channelId, channelName: ch.name ?? "", kind: types },
          })),
        );
      };

      // Steady state: advance from cursor.latest toward now.
      if (cursor.latest && calls < callBudget) {
        const res = await call(() =>
          client.conversations.history({ channel: channelId, oldest: cursor.latest, limit: 200 }),
        );
        const msgs = ((res.messages ?? []) as Array<Record<string, unknown>>).reverse();
        if (msgs.length > 0) {
          await processPage(msgs);
          cursor.latest = (msgs[msgs.length - 1] as { ts?: string }).ts ?? cursor.latest;
        }
      }

      // Backfill: newest→oldest until the horizon.
      if (!cursor.backfillDone && calls < callBudget) {
        const res = await call(() =>
          client.conversations.history({
            channel: channelId,
            ...(cursor.backfillOldest ? { latest: cursor.backfillOldest } : {}),
            oldest: horizonTs,
            limit: 200,
          }),
        );
        const msgs = ((res.messages ?? []) as Array<Record<string, unknown>>).reverse();
        if (msgs.length > 0) {
          await processPage(msgs);
          cursor.backfillOldest = (msgs[0] as { ts?: string }).ts;
          if (!cursor.latest) cursor.latest = (msgs[msgs.length - 1] as { ts?: string }).ts;
        }
        if (!res.has_more) cursor.backfillDone = true;
      }
      if (!cursor.backfillDone) allBackfillDone = false;

      // Active threads: re-rollup ones with new replies.
      const threadIds = Object.keys(active).slice(0, ACTIVE_THREAD_CAP);
      for (const threadTs of threadIds) {
        if (calls >= callBudget) break;
        if (Date.now() - slackTsToMs(threadTs) > ACTIVE_THREAD_IDLE_MS) {
          delete active[threadTs];
          continue;
        }
        const res = await call(() => client.conversations.replies({ channel: channelId, ts: threadTs, limit: 200 }));
        const msgs = (res.messages ?? []) as Array<Record<string, unknown>>;
        const lastTs = (msgs[msgs.length - 1] as { ts?: string } | undefined)?.ts ?? "0";
        if (lastTs !== active[threadTs]) {
          const rolled = rollupThread({ channelLabel: label(ch), messages: toKb(msgs as never) });
          const threadSource: KbChunk["source"] = mode === "workspace" ? "slack_thread" : "slack_dm";
          await upsert(
            rolled.map((c) => ({
              scope: principal.scope,
              userId: principal.userId,
              source: threadSource,
              sourceRef: `${channelId}:thread:${threadTs}`,
              chunkSeq: c.chunkSeq,
              text: c.text,
              ts: c.tsMs,
              permalink: permalink(channelId, threadTs),
              meta: { channelId, channelName: ch.name ?? "", threadTs },
            })),
          );
          await store.deleteStaleSeqs(
            principal.scope,
            principal.userId,
            threadSource,
            `${channelId}:thread:${threadTs}`,
            rolled.length - 1,
          );
          active[threadTs] = lastTs;
        }
      }

      cursor.activeThreads = active;
      await store.setCursor(principal.scope, principal.userId, "slack", channelId, cursor);
    }

    logger.debug({ mode, userId: principal.userId, chunksUpserted, calls }, "slack kb slice done");
    return { chunksUpserted, apiCalls: calls, backfillDone: allBackfillDone };
  };
}
