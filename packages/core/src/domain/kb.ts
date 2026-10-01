/**
 * Knowledge-base domain logic: chunking + relevance scoring. Pure functions —
 * no I/O, no SDKs, fully unit-testable. Token counts are estimated at
 * chars/4; only budgets matter, not precision.
 *
 * Chunk-size rationale: 300–700 tokens keeps one chunk ≈ one topic (cosine
 * similarity stays discriminative) while carrying enough conversational
 * context; topK=8 × ~700 tokens ≈ 5.6k tokens of tool output — comfortable in
 * a chat turn and far under the embedder's input cap.
 */

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Recency-weighted relevance: score = (1−w)·sim + w·exp(−age/τ).
 * Mirrors the SQL rerank in the pg store (kept in sync by tests). With w=0.3,
 * τ=30d: a week-old chunk gets +0.24 recency, a 2-month-old +0.04 — the old
 * one must win by ~0.26 similarity to outrank. w is forced to 0 when the
 * caller passed explicit date filters (time intent already handled).
 */
export function scoreChunk(sim: number, ageMs: number, w: number, tauDays: number): number {
  const recency = Math.exp(-Math.max(0, ageMs) / (tauDays * 86_400_000));
  return (1 - w) * sim + w * recency;
}

// ── Slack chunking ────────────────────────────────────────────────────────────

export interface SlackKbMessage {
  /** Slack ts ("1753372800.000123"). */
  ts: string;
  /** Display name (resolved) or user id. */
  author: string;
  text: string;
}

export interface KbTextChunk {
  chunkSeq: number;
  text: string;
  /** Content time: epoch ms of the LAST message in the chunk. */
  tsMs: number;
}

export const slackTsToMs = (ts: string): number => Math.round(Number.parseFloat(ts) * 1000);

const fmtDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const fmtStamp = (ms: number): string => {
  const d = new Date(ms);
  return `${d.toISOString().slice(5, 10)} ${d.toISOString().slice(11, 16)}`;
};

const msgLine = (m: SlackKbMessage): string => `[${fmtStamp(slackTsToMs(m.ts))}] ${m.author}: ${m.text}`;

/**
 * Roll a thread into ≤~700-token chunks, splitting at message boundaries with
 * a 2-message overlap (messages are the semantic unit — token-mid splits
 * produce garbage matches).
 */
export function rollupThread(opts: {
  channelLabel: string;
  messages: SlackKbMessage[];
  maxTokens?: number;
}): KbTextChunk[] {
  const { channelLabel, messages, maxTokens = 700 } = opts;
  if (messages.length === 0) return [];

  const participants = [...new Set(messages.map((m) => m.author))].slice(0, 6).join(", ");
  const startMs = slackTsToMs((messages[0] as SlackKbMessage).ts);
  const header = `${channelLabel} — thread, ${fmtDay(startMs)} (${participants})`;

  const chunks: KbTextChunk[] = [];
  let buf: SlackKbMessage[] = [];
  let seq = 0;

  const flush = (): void => {
    if (buf.length === 0) return;
    const text = [header, ...buf.map(msgLine)].join("\n");
    chunks.push({ chunkSeq: seq++, text, tsMs: slackTsToMs((buf[buf.length - 1] as SlackKbMessage).ts) });
  };

  for (const m of messages) {
    buf.push(m);
    const size = estimateTokens([header, ...buf.map(msgLine)].join("\n"));
    if (size >= maxTokens && buf.length > 1) {
      flush();
      buf = buf.slice(-2); // 2-message overlap into the next chunk
    }
  }
  // Trailing buffer: skip if it's ONLY the overlap carried forward (all
  // messages already flushed) — otherwise emit the remainder.
  if (chunks.length === 0 || buf.length > 2) flush();
  else if (buf.length > 0 && chunks.length > 0) {
    const lastFlushedTs = chunks[chunks.length - 1]?.tsMs ?? 0;
    if (slackTsToMs((buf[buf.length - 1] as SlackKbMessage).ts) > lastFlushedTs) flush();
  }
  return chunks;
}

export interface SlackWindow {
  /** Stable ref component: ts of the first message in the window. */
  refTs: string;
  text: string;
  tsMs: number;
  /** False for the still-open tail window (re-upserted as it grows). */
  closed: boolean;
}

/**
 * Batch a channel's standalone (non-thread) messages into windows: flush at
 * ~500 tokens, 25 messages, or a UTC day boundary. The final window is
 * reported open (closed=false) — the indexer re-upserts it under its stable
 * ref each cycle, so recent messages are never missing from the KB.
 */
export function windowMessages(opts: {
  channelLabel: string;
  messages: SlackKbMessage[];
  maxTokens?: number;
  maxMessages?: number;
}): SlackWindow[] {
  const { channelLabel, messages, maxTokens = 500, maxMessages = 25 } = opts;
  if (messages.length === 0) return [];

  const windows: SlackWindow[] = [];
  let buf: SlackKbMessage[] = [];

  const flush = (closed: boolean): void => {
    if (buf.length === 0) return;
    const first = buf[0] as SlackKbMessage;
    const last = buf[buf.length - 1] as SlackKbMessage;
    const header = `${channelLabel} — ${fmtDay(slackTsToMs(first.ts))}`;
    windows.push({
      refTs: first.ts,
      text: [header, ...buf.map(msgLine)].join("\n"),
      tsMs: slackTsToMs(last.ts),
      closed,
    });
    buf = [];
  };

  for (const m of messages) {
    const prev = buf[buf.length - 1];
    if (prev && fmtDay(slackTsToMs(prev.ts)) !== fmtDay(slackTsToMs(m.ts))) flush(true); // day boundary
    buf.push(m);
    const size = estimateTokens(buf.map(msgLine).join("\n"));
    if (size >= maxTokens || buf.length >= maxMessages) flush(true);
  }
  flush(false); // open tail
  return windows;
}

// ── Gmail chunking ────────────────────────────────────────────────────────────

export interface EmailInput {
  subject: string;
  from: string;
  dateMs: number;
  /** Plain-text body, quoted-reply-stripped by the caller. */
  body: string;
}

/**
 * One email = one chunk; long bodies split at paragraph boundaries into
 * ~600-token chunks with ~60-token tail overlap (prose has no message
 * boundary, so token-ish overlap is right here).
 */
export function chunkEmail(email: EmailInput, maxTokens = 600, overlapTokens = 60): KbTextChunk[] {
  const header = `Subject: ${email.subject}\nFrom: ${email.from}\nDate: ${fmtDay(email.dateMs)}`;
  const body = email.body.trim();
  if (estimateTokens(`${header}\n${body}`) <= maxTokens + 200) {
    return [{ chunkSeq: 0, text: `${header}\n${body}`, tsMs: email.dateMs }];
  }

  const paragraphs = body.split(/\n{2,}/);
  const chunks: KbTextChunk[] = [];
  let buf: string[] = [];
  let seq = 0;

  const flush = (): void => {
    if (buf.length === 0) return;
    chunks.push({ chunkSeq: seq++, text: `${header}\n${buf.join("\n\n")}`, tsMs: email.dateMs });
  };

  for (const p of paragraphs) {
    buf.push(p);
    if (estimateTokens(buf.join("\n\n")) >= maxTokens) {
      flush();
      // Tail overlap: carry the last paragraph forward if it's small enough.
      const lastP = buf[buf.length - 1] as string;
      buf = estimateTokens(lastP) <= overlapTokens ? [lastP] : [];
    }
  }
  if (
    buf.length > 0 &&
    (chunks.length === 0 || buf.join("\n\n") !== chunks[chunks.length - 1]?.text.slice(-buf.join("\n\n").length))
  ) {
    flush();
  }
  return chunks;
}
