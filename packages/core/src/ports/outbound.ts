/**
 * Outbound (driven) ports — the interfaces the domain/application depend on and
 * the infrastructure adapters implement. Nothing here imports a concrete SDK;
 * `ConversationMessage` and `Tools` are opaque handles the domain shuttles
 * between adapters without inspecting them.
 */
import type {
  CapabilityConfig,
  Identity,
  IdentityProvider,
  TinoUser,
} from "../domain/types.js";

// ── Opaque handles ────────────────────────────────────────────────────────────

/**
 * One conversation message. Opaque to the domain: only the model adapter knows
 * the concrete shape (an AI-SDK ModelMessage). The domain persists and replays
 * these without ever reading their fields.
 */
export type ConversationMessage = unknown;

/** A per-user toolset handle. Opaque to the domain; the model adapter executes it. */
export type Tools = unknown;

// ── Logging ───────────────────────────────────────────────────────────────────

/** Minimal structured logger — the pino subset actually used. */
export interface Logger {
  debug: (msgOrObj: unknown, msg?: string) => void;
  info: (msgOrObj: unknown, msg?: string) => void;
  warn: (msgOrObj: unknown, msg?: string) => void;
  error: (msgOrObj: unknown, msg?: string) => void;
}

// ── LLM ───────────────────────────────────────────────────────────────────────

/**
 * The language model, behind a port. `reply` runs one turn — including any
 * multi-step tool loop — and returns the assistant's text plus the new
 * messages (the user turn + assistant/tool turns) to append to history.
 */
export interface ChatModel {
  reply(input: {
    system: string;
    history: readonly ConversationMessage[];
    userText: string;
    tools: Tools;
  }): Promise<{ text: string; newMessages: ConversationMessage[] }>;
}

/** Builds the toolset for a given user and names the tools inside a handle. */
export interface ToolProvider {
  forUser(userId: string): Promise<Tools>;
  names(tools: Tools): string[];
}

// ── Conversation history ──────────────────────────────────────────────────────

export interface HistoryStore {
  get(userId: string): Promise<ConversationMessage[]>;
  append(userId: string, msgs: ConversationMessage[]): Promise<void>;
  reset(userId: string): Promise<void>;
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface ConfigStore {
  /** Raw JSON string for the key, or null if unset. */
  get(key: string): Promise<string | null>;
  /** JSON.parse(value) if present, else `fallback`. */
  getTyped<T>(key: string, fallback: T): Promise<T>;
  /** JSON.stringify(value) and store under key. */
  set(key: string, value: unknown): Promise<void>;
  /** All entries sorted by key. */
  list(): Promise<Array<{ key: string; value: string; updatedAt: number }>>;
  /** Delete the entry; true if it existed. */
  delete(key: string): Promise<boolean>;
}

// ── Users + identities ────────────────────────────────────────────────────────

export interface UserStore {
  create(user: TinoUser): Promise<TinoUser>;
  get(id: string): Promise<TinoUser | null>;
  getByEmail(email: string): Promise<TinoUser | null>;
  list(): Promise<TinoUser[]>;
  update(id: string, patch: Partial<Pick<TinoUser, "role" | "status" | "slackUserId" | "name">>): Promise<TinoUser>;
}

export interface IdentityStore {
  /** Resolve a `(provider, externalId)` to its linked tinoUserId, or null. */
  resolve(provider: IdentityProvider, externalId: string): Promise<string | null>;
  /** Link a new identity. Throws IdentityLinkConflictError on a duplicate. */
  link(identity: Identity): Promise<void>;
  listForUser(tinoUserId: string): Promise<Identity[]>;
}

/**
 * Resolves an external sender to a tino user, provisioning one when policy
 * allows. Talks to the identity provider (e.g. Slack) to fetch profile data,
 * so it lives on the driven side.
 */
export interface IdentityResolver {
  resolveSlack(slackUserId: string): Promise<string | null>;
  resolveGoogle(email: string): Promise<string | null>;
  provisionFromSlack(
    slackUserId: string,
    opts: { mode: "org-domain"; orgDomain?: string },
  ): Promise<TinoUser>;
}

// ── Per-user credentials (encrypted) ──────────────────────────────────────────

export interface UserCapabilityStore {
  get(userId: string, capabilityId: string): Promise<CapabilityConfig | null>;
  set(userId: string, capabilityId: string, config: CapabilityConfig): Promise<void>;
  list(userId: string): Promise<Array<{ capabilityId: string; enabled: boolean }>>;
  delete(userId: string, capabilityId: string): Promise<boolean>;
}

// ── Knowledge base ────────────────────────────────────────────────────────────

/** Text embedder (Vertex in prod). Vectors are unit-normalized by the adapter. */
export interface Embedder {
  /** Embed document chunks for storage (RETRIEVAL_DOCUMENT). */
  embedDocuments(texts: string[]): Promise<number[][]>;
  /** Embed one search query (RETRIEVAL_QUERY). */
  embedQuery(text: string): Promise<number[]>;
}

export type KbScope = "workspace" | "user";
export type KbSource = "slack_channel" | "slack_thread" | "slack_dm" | "gmail";

export interface KbChunk {
  scope: KbScope;
  /** tino UUID for scope='user'; '' for workspace rows. */
  userId: string;
  source: KbSource;
  /** Idempotency key within (scope,userId,source) — e.g. 'C123:thread:<ts>'. */
  sourceRef: string;
  chunkSeq: number;
  text: string;
  /** Content time (epoch ms) — last message in the chunk / email internalDate. */
  ts: number;
  permalink?: string;
  meta?: Record<string, unknown>;
}

export interface KbSearchHit {
  text: string;
  source: KbSource;
  ts: number;
  permalink?: string;
  meta: Record<string, unknown>;
  sim: number;
  score: number;
}

export interface KbSearchQuery {
  scope: KbScope;
  /** Server-injected; '' for workspace. Never model-supplied. */
  userId: string;
  embedding: number[];
  topK: number;
  afterMs?: number;
  beforeMs?: number;
  sources?: KbSource[];
  /** Blend weight w in score=(1−w)·sim + w·exp(−age/τ). 0 disables recency. */
  recencyWeight: number;
  recencyTauDays: number;
}

export interface KbCursorRow {
  stream: string;
  state: Record<string, unknown>;
}

export interface KbIndexState {
  scope: KbScope;
  userId: string;
  source: "slack" | "gmail";
  status: "active" | "paused_auth" | "paused_error" | "disabled";
  backfillDone: boolean;
  lastCycleAt?: number;
  pausedAt?: number;
  lastError?: string;
}

/** One row in the browse view (no embedding — human-readable only). */
export interface KbBrowseItem {
  id: string;
  text: string;
  source: KbSource;
  sourceRef: string;
  chunkSeq: number;
  ts: number;
  permalink?: string;
  meta: Record<string, unknown>;
  indexedAt: number;
}

export interface KnowledgeStore {
  /** Idempotent upsert (skips unchanged content by hash). Returns rows written. */
  upsertChunks(chunks: KbChunk[], embeddings: number[][]): Promise<number>;
  /** Recent-first listing for the browse UI (no vector math). */
  listChunks(
    scope: KbScope,
    userId: string,
    opts: { limit: number; offset: number; source?: KbSource },
  ): Promise<{ items: KbBrowseItem[]; total: number }>;
  /** Chunk counts + newest content time per source, for the status view. */
  statsBySource(
    scope: KbScope,
    userId: string,
  ): Promise<Array<{ source: KbSource; chunks: number; newestMs: number | null }>>;
  /** Remove stale tails after a re-chunk produced fewer sequences. */
  deleteStaleSeqs(scope: KbScope, userId: string, source: KbSource, sourceRef: string, maxSeq: number): Promise<void>;
  /** ANN + recency-weighted rerank. */
  search(query: KbSearchQuery): Promise<KbSearchHit[]>;
  /** Coverage stats for a scope (chunk count + content-time range). */
  stats(scope: KbScope, userId: string): Promise<{ chunks: number; oldestMs: number | null; newestMs: number | null }>;
  /** Delete a user's chunks + cursors and tombstone their index state. */
  forgetUser(userId: string): Promise<void>;

  getCursor(scope: KbScope, userId: string, source: string, stream: string): Promise<Record<string, unknown> | null>;
  setCursor(scope: KbScope, userId: string, source: string, stream: string, state: Record<string, unknown>): Promise<void>;

  getIndexState(scope: KbScope, userId: string, source: "slack" | "gmail"): Promise<KbIndexState | null>;
  setIndexState(state: KbIndexState): Promise<void>;
  listIndexStates(): Promise<KbIndexState[]>;
}

// ── Crypto ────────────────────────────────────────────────────────────────────

/** Fixed 3-field encryption context, bound to AAD to prevent cross-context decrypt. */
export interface EncryptionContext {
  userId: string;
  capabilityId: string;
  fieldName: string;
}

/** Encrypted envelope. `encryptedDataKey` present for the KMS adapter only. */
export interface EnvelopeCiphertext {
  algorithm: "AES-256-GCM/v1";
  ciphertext: string;
  authTag: string;
  iv: string;
  encryptedDataKey?: string;
}

export interface CryptoAdapter {
  encrypt(plaintext: string, context: EncryptionContext): Promise<EnvelopeCiphertext>;
  decrypt(envelope: EnvelopeCiphertext, context: EncryptionContext): Promise<string>;
}

