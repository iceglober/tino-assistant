/**
 * Gmail KB source — per-user, via the stored OAuth refresh token. Incremental
 * sync uses messages.list with an `after:` epoch query (idempotent and
 * restart-safe; historyId expires and delivers label noise). Backfill walks
 * `before:` windows newest→oldest to the horizon. Promotions/social/forums
 * are excluded; SENT is included (the user's own words are high-signal).
 *
 * The person's "don't learn from" list is honoured three ways: excluded
 * searches are left out of the Gmail query, messages carrying an excluded label
 * are skipped by label id, and whenever the list changes, mail it matches that
 * was already learned is forgotten (excerpts, and facts resting only on them).
 */

import { KbAuthError, type KbPrincipal, type KbRunResult } from "@tino/core/application/kb-indexer";
import { excludedGmailLabelIds, exclusionsFingerprint, gmailSearchExcluding } from "@tino/core/domain/dont-learn-from";
import { chunkEmail } from "@tino/core/domain/kb";
import { isLikelyNoise } from "@tino/core/domain/knowledge";
import type {
  ConfigStore,
  DontLearnFromStore,
  Embedder,
  KbChunk,
  KnowledgeStore,
  Logger,
  UserCapabilityStore,
} from "@tino/core/ports/outbound";
import { extractBody, stripQuotedReply } from "../../tools/google/gmail-body.js";
import { gmailClientFor, messagesMatching } from "./gmail-exclusions.js";

interface GmailCursor {
  lastInternalDateMs?: number;
  backfillBeforeMs?: number;
  backfillDone?: boolean;
  /** Fingerprint of the exclusion list whose already-learned mail has been forgotten. */
  exclusionsCleanedUp?: string;
  [key: string]: unknown;
}

interface GmailSourceDeps {
  store: KnowledgeStore;
  embedder: Embedder;
  config: ConfigStore;
  userCapabilities: UserCapabilityStore;
  dontLearnFrom: DontLearnFromStore;
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
  const { store, embedder, userCapabilities, dontLearnFrom, logger } = deps;
  const backfillDays = deps.backfillDays ?? 90;

  return async (principal: KbPrincipal, backfillDone: boolean): Promise<KbRunResult> => {
    const gmail = await gmailClientFor(principal.userId, userCapabilities);
    if (!gmail) throw new KbAuthError("no gmail credentials");

    const exclusions = await dontLearnFrom.get(principal.userId);
    const excludedLabels = excludedGmailLabelIds(exclusions);
    const exclude = `${EXCLUDE}${gmailSearchExcluding(exclusions)}`;

    const messageBudget = deps.messageBudget ?? (backfillDone ? 25 : 100);
    let apiCalls = 0;
    let chunksUpserted = 0;
    const horizonMs = Date.now() - backfillDays * 86_400_000;

    const cursor: GmailCursor =
      ((await store.getCursor(principal.scope, principal.userId, "gmail", "inbox")) as GmailCursor | null) ?? {};
    let messagesIndexed = 0;
    let skippedNoise = 0;
    let skippedExcluded = 0;
    let forgotten = { excerpts: 0, facts: 0 };

    const indexMessage = async (id: string): Promise<number> => {
      apiCalls++;
      const res = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const data = res.data;
      const headers = data.payload?.headers ?? [];
      const h = (name: string): string =>
        headers.find((x) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
      const internalMs = Number(data.internalDate ?? 0);
      if ((data.labelIds ?? []).some((l) => excludedLabels.has(l))) {
        skippedExcluded++;
        return internalMs;
      }
      const body = stripQuotedReply(extractBody(data.payload ?? undefined)).slice(0, 100_000);
      if (!body && !h("Subject")) return internalMs;

      // Newsletters and automated mail dominate an inbox by volume and hold no
      // durable knowledge — keeping them out costs nothing and keeps the KB
      // about the person rather than about their subscriptions.
      if (isLikelyNoise("gmail", [h("From"), h("Subject"), body].join("\n"))) {
        skippedNoise++;
        return internalMs;
      }

      const chunks = chunkEmail({ subject: h("Subject") || "(no subject)", from: h("From"), dateMs: internalMs, body });
      const kbChunks: KbChunk[] = chunks.map((c) => ({
        scope: principal.scope,
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
      await store.deleteStaleSeqs(principal.scope, principal.userId, "gmail", id, chunks.length - 1);
      messagesIndexed++;
      return internalMs;
    };

    try {
      let budget = messageBudget;

      // ── Forget mail the current exclusions match, once per change of list ──
      const fingerprint = exclusionsFingerprint(exclusions);
      if ((cursor.exclusionsCleanedUp ?? "") !== fingerprint) {
        // Reach back to the oldest thing indexed, not just today's horizon.
        const oldest = (await store.stats(principal.scope, principal.userId)).oldestMs ?? horizonMs;
        const afterSec = Math.floor(Math.min(oldest, horizonMs) / 1000) - 86_400;
        const matched = new Set<string>();
        for (const exclusion of exclusions.gmail) {
          const { ids, apiCalls: calls } = await messagesMatching(gmail, exclusion, afterSec);
          apiCalls += calls;
          for (const id of ids) matched.add(id);
        }
        const removed = await store.forgetSourceItems(principal.scope, principal.userId, "gmail", [...matched]);
        forgotten = { excerpts: removed.excerptsRemoved, facts: removed.factsRemoved };
        cursor.exclusionsCleanedUp = fingerprint;
        if (removed.excerptsRemoved > 0) {
          logger.info({ userId: principal.userId, ...removed }, "forgot mail matching don't-learn-from exclusions");
        }
      }

      // ── Steady state: everything since the cursor (2-min overlap for skew) ──
      const afterSec = cursor.lastInternalDateMs
        ? Math.floor(cursor.lastInternalDateMs / 1000) - 120
        : Math.floor(horizonMs / 1000);
      apiCalls++;
      const list = await gmail.users.messages.list({
        userId: "me",
        q: `after:${afterSec} ${exclude}`,
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
          q: `before:${beforeSec} after:${Math.floor(horizonMs / 1000)} ${exclude}`,
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

      await store.setCursor(principal.scope, principal.userId, "gmail", "inbox", cursor);
      logger.debug({ userId: principal.userId, chunksUpserted, apiCalls }, "gmail kb slice done");
      return {
        chunksUpserted,
        apiCalls,
        backfillDone: cursor.backfillDone ?? false,
        detail: [
          messagesIndexed + " messages read",
          skippedNoise > 0 ? skippedNoise + " bulk mail skipped" : "",
          skippedExcluded > 0 ? `${skippedExcluded} excluded skipped` : "",
          forgotten.excerpts > 0 ? `forgot ${forgotten.excerpts} excluded excerpts and ${forgotten.facts} facts` : "",
          cursor.backfillDone ? "backfill complete" : "backfilling",
        ]
          .filter(Boolean)
          .join(", "),
      };
    } catch (err) {
      if (isAuthError(err)) throw new KbAuthError((err as Error).message);
      throw err;
    }
  };
}
