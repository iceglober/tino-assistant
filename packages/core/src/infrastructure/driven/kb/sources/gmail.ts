/**
 * Gmail KB source — per-user, via the stored OAuth refresh token. Incremental
 * sync uses messages.list with an `after:` epoch query (idempotent and
 * restart-safe; historyId expires and delivers label noise). Backfill walks
 * `before:` windows newest→oldest to the horizon. Promotions/social/forums
 * are excluded; SENT is included (the user's own words are high-signal).
 */
import { google } from "googleapis";
import { chunkEmail } from "../../../../domain/kb.js";
import { KbAuthError, type KbPrincipal, type KbRunResult } from "../../../../application/kb-indexer.js";
import type { ConfigStore, Embedder, KbChunk, KnowledgeStore, Logger, UserCapabilityStore } from "../../../../ports/outbound.js";
import { extractBody, stripQuotedReply } from "../../tools/google/gmail-body.js";
import { readUserCredentials } from "../../tools/credentials.js";

interface GmailCursor {
  lastInternalDateMs?: number;
  backfillBeforeMs?: number;
  backfillDone?: boolean;
  [key: string]: unknown;
}

interface GmailSourceDeps {
  store: KnowledgeStore;
  embedder: Embedder;
  config: ConfigStore;
  userCapabilities: UserCapabilityStore;
  logger: Logger;
  backfillDays?: number;
  messageBudget?: number;
}

const EXCLUDE = "-in:spam -in:trash -category:promotions -category:social -category:forums";

function isAuthError(err: unknown): boolean {
  const code = (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status;
  const msg = ((err as Error).message ?? "").toLowerCase();
  return code === 401 || code === 403 || msg.includes("invalid_grant");
}

export function createGmailKbSource(deps: GmailSourceDeps) {
  const { store, embedder, config, userCapabilities, logger } = deps;
  const backfillDays = deps.backfillDays ?? 90;

  return async (principal: KbPrincipal, backfillDone: boolean): Promise<KbRunResult> => {
    const cap = await readUserCredentials(principal.userId, "gmail", config, userCapabilities);
    const creds = cap?.credentials;
    if (!creds?.clientId || !creds?.clientSecret || !creds?.refreshToken) {
      throw new KbAuthError("no gmail credentials");
    }
    const auth = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
    auth.setCredentials({ refresh_token: creds.refreshToken });
    const gmail = google.gmail({ version: "v1", auth });

    const messageBudget = deps.messageBudget ?? (backfillDone ? 25 : 100);
    let apiCalls = 0;
    let chunksUpserted = 0;
    const horizonMs = Date.now() - backfillDays * 86_400_000;

    const cursor: GmailCursor =
      ((await store.getCursor("user", principal.userId, "gmail", "inbox")) as GmailCursor | null) ?? {};

    const indexMessage = async (id: string): Promise<number> => {
      apiCalls++;
      const res = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const data = res.data;
      const headers = data.payload?.headers ?? [];
      const h = (name: string): string => headers.find((x) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
      const internalMs = Number(data.internalDate ?? 0);
      const body = stripQuotedReply(extractBody(data.payload ?? undefined)).slice(0, 100_000);
      if (!body && !h("Subject")) return internalMs;

      const chunks = chunkEmail({ subject: h("Subject") || "(no subject)", from: h("From"), dateMs: internalMs, body });
      const kbChunks: KbChunk[] = chunks.map((c) => ({
        scope: "user",
        userId: principal.userId,
        source: "gmail",
        sourceRef: id,
        chunkSeq: c.chunkSeq,
        text: c.text,
        ts: c.tsMs || internalMs,
        permalink: `https://mail.google.com/mail/u/0/#all/${id}`,
        meta: { subject: h("Subject"), from: h("From"), threadId: data.threadId ?? "" },
      }));
      const embeddings = await embedder.embedDocuments(kbChunks.map((c) => c.text));
      chunksUpserted += await store.upsertChunks(kbChunks, embeddings);
      await store.deleteStaleSeqs("user", principal.userId, "gmail", id, chunks.length - 1);
      return internalMs;
    };

    try {
      let budget = messageBudget;

      // ── Steady state: everything since the cursor (2-min overlap for skew) ──
      const afterSec = cursor.lastInternalDateMs
        ? Math.floor(cursor.lastInternalDateMs / 1000) - 120
        : Math.floor(horizonMs / 1000);
      apiCalls++;
      const list = await gmail.users.messages.list({
        userId: "me",
        q: `after:${afterSec} ${EXCLUDE}`,
        maxResults: Math.min(budget, 100),
      });
      let maxSeen = cursor.lastInternalDateMs ?? 0;
      for (const m of list.data.messages ?? []) {
        if (!m.id || budget <= 0) break;
        budget--;
        const ms = await indexMessage(m.id);
        if (ms > maxSeen) maxSeen = ms;
      }
      if (maxSeen > (cursor.lastInternalDateMs ?? 0)) cursor.lastInternalDateMs = maxSeen;
      if (cursor.lastInternalDateMs === undefined) cursor.lastInternalDateMs = Date.now();

      // ── Backfill: walk older windows toward the horizon ──
      if (!cursor.backfillDone && budget > 0) {
        const beforeSec = Math.floor((cursor.backfillBeforeMs ?? Date.now()) / 1000);
        apiCalls++;
        const back = await gmail.users.messages.list({
          userId: "me",
          q: `before:${beforeSec} after:${Math.floor(horizonMs / 1000)} ${EXCLUDE}`,
          maxResults: Math.min(budget, 100),
        });
        const ids = (back.data.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
        let minSeen = cursor.backfillBeforeMs ?? Date.now();
        for (const id of ids) {
          if (budget <= 0) break;
          budget--;
          const ms = await indexMessage(id);
          if (ms > 0 && ms < minSeen) minSeen = ms;
        }
        cursor.backfillBeforeMs = minSeen;
        if (ids.length === 0) cursor.backfillDone = true;
      }

      await store.setCursor("user", principal.userId, "gmail", "inbox", cursor);
      logger.debug({ userId: principal.userId, chunksUpserted, apiCalls }, "gmail kb slice done");
      return { chunksUpserted, apiCalls, backfillDone: cursor.backfillDone ?? false };
    } catch (err) {
      if (isAuthError(err)) throw new KbAuthError((err as Error).message);
      throw err;
    }
  };
}
