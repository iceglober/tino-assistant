/**
 * Outbound (driven) ports — the interfaces the domain/application depend on and
 * the infrastructure adapters implement. Nothing here imports a concrete SDK;
 * `ConversationMessage` and `Tools` are opaque handles the domain shuttles
 * between adapters without inspecting them.
 */

import type { DontLearnFrom } from "../domain/dont-learn-from.js";
import type { Org } from "../domain/org.js";
import type { CapabilityConfig, Identity, IdentityProvider, TinoUser } from "../domain/types.js";
import type { Readers, WhoCanSee } from "../domain/who-can-see.js";

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
  /**
   * Who wrote a message and its plain text, without exposing the SDK shape.
   * `text` is null for messages with nothing a person would read (tool calls
   * and results).
   */
  describe(message: ConversationMessage): { role: "user" | "assistant" | "tool" | "system"; text: string | null };
}

/** What a reply is being built for — enough for the provider to pick safe tools. */
export interface ToolRequest {
  /** The person asking. Their credentials are the ones used. */
  userId: string;
  readers: Readers;
  /** The channel tino was @mentioned in, if any. */
  askedInChannelId?: string;
  /** Offered only when others will read the reply: hand the private part to the asker's DM. */
  continueInDm?: () => void;
}

/**
 * Builds the toolset for one reply: every tool group whose results the readers
 * may see, and nothing else. Also reports who may see a reply built from them
 * (null when no tool group contributed anything).
 */
export interface ToolProvider {
  toolsFor(request: ToolRequest): Promise<{ tools: Tools; whoCanSeeResults: WhoCanSee | null }>;
  names(tools: Tools): string[];
}

// ── Conversation log ──────────────────────────────────────────────────────────

/** Where a message was asked. */
export type AskedWhere = "slack_dm" | "web_chat" | "channel";

/** One stored message. Every message of one reply shares a `turnId` and `whoCanSee`. */
export interface LoggedMessage {
  /** 'direct:<userId>' for DMs + web chat, 'channel:<channelId>:<threadTs>' for threads. */
  threadKey: string;
  turnId: string;
  askedBy: string;
  askedWhere: AskedWhere;
  whoCanSee: WhoCanSee;
  role: "user" | "assistant" | "tool" | "system";
  /** Plain text for recall elsewhere; null for tool traffic. */
  text: string | null;
  message: ConversationMessage;
  createdAt: number;
}

/**
 * Every conversation tino has had, labelled with who may see each message.
 * Replaces the per-user history blob so a reply can draw on any conversation
 * its readers are allowed to see, not just the one it's in.
 */
export interface ConversationLog {
  append(messages: LoggedMessage[]): Promise<void>;
  /** The latest `limit` messages of a thread, oldest first. */
  recentInThread(threadKey: string, limit: number): Promise<LoggedMessage[]>;
  /** The latest `limit` messages from turns this user asked, anywhere, oldest first. */
  recentAskedBy(userId: string, limit: number): Promise<LoggedMessage[]>;
  clearThread(threadKey: string): Promise<void>;
}

// ── Slack channel facts + sending ─────────────────────────────────────────────

/** What tino needs to know about Slack channels to decide who reads a reply. */
export interface ChannelDirectory {
  /** Null when the channel can't be looked up — callers must then assume the worst. */
  describeChannel(channelId: string): Promise<{ includesOutsiders: boolean } | null>;
  /** Channels this Slack user is a member of (that the bot can see). */
  channelsOfSlackUser(slackUserId: string): Promise<ReadonlySet<string>>;
}

/** Sends a private message to one tino user (a Slack DM). */
export interface DirectMessenger {
  sendToUser(userId: string, text: string): Promise<void>;
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

// ── Orgs (tenants) ────────────────────────────────────────────────────────────

/** Platform-wide org registry. Everything else is bound to one org. */
export interface OrgStore {
  /** Throws OrgSlugTakenError when the slug is in use. */
  create(org: Org): Promise<Org>;
  get(id: string): Promise<Org | null>;
  getBySlug(slug: string): Promise<Org | null>;
  /** The org whose Slack app is installed in this workspace. */
  getBySlackTeam(teamId: string): Promise<Org | null>;
  list(): Promise<Org[]>;
  update(id: string, patch: Partial<Pick<Org, "name" | "status" | "slackTeamId">>): Promise<Org>;
}

/** One person's account in one org. */
export interface Membership {
  org: Org;
  user: TinoUser;
}

/** An invitation to an org that hasn't been accepted yet. */
export interface PendingInvitation {
  id: string;
  email: string;
  role: "admin" | "member";
  expiresAt: number;
  invitedBy: string | null;
}

/**
 * An org's open invitations. Creating and accepting them on the web goes
 * through the auth provider (which checks permissions and the invitee's
 * session); `claim` is for the one path with no session: a person who was
 * invited by email and first shows up by DMing the bot from that address.
 */
export interface InvitationStore {
  list(): Promise<PendingInvitation[]>;
  /** The newest unexpired pending invitation for this address. */
  pendingFor(email: string): Promise<PendingInvitation | null>;
  /** Turn the pending invitation for this address into a membership; null if there is none. */
  claim(email: string, name?: string): Promise<TinoUser | null>;
}

/** Cross-org lookups by email — the only reads that span orgs, used at sign-in. */
export interface MembershipDirectory {
  /** Every org this address has an account in (any status). */
  byEmail(email: string): Promise<Membership[]>;
  /** Orgs whose join policy admits this address by domain (and where they have no account). */
  joinableByDomain(email: string): Promise<Org[]>;
}

// ── Users + identities ────────────────────────────────────────────────────────

// UserStore, IdentityStore, ConfigStore and ConversationLog are bound to one org
// by the composition root; their methods never take an org id.

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
    opts: { mode: "allowlist" | "org-domain"; orgDomain?: string },
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

/**
 * 'workspace' is what the company can see (public Slack channels); 'private' is
 * one person's own DMs, private channels, and mail. The stored value matches
 * these names — see the scope migration in the KB schema.
 */
export type KbScope = "workspace" | "private";
export type KbSource = "slack_channel" | "slack_thread" | "slack_dm" | "gmail";

export interface KbChunk {
  scope: KbScope;
  /** tino UUID for scope='private'; '' for workspace rows. */
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

// ── Distilled knowledge ───────────────────────────────────────────────────────

/** What a fact is *about* — browse groups by this, not by where it came from. */
export type KbFactKind = "project" | "person" | "problem" | "commitment" | "decision" | "preference" | "fact";

export const KB_FACT_KINDS: readonly KbFactKind[] = [
  "project",
  "problem",
  "commitment",
  "decision",
  "person",
  "preference",
  "fact",
];

/** One chunk backing a fact — the receipt behind the claim. */
export interface KbEvidence {
  chunkId: string;
  source: KbSource;
  ts: number;
  permalink?: string;
  snippet: string;
}

/**
 * An atomic thing Tino knows. `subject` groups related statements ("Stedi POC")
 * and `statement` is the claim. Merge identity is (scope, userId, kind, key),
 * where `key` is a slug of the statement, so re-observing a fact updates
 * lastSeen and appends evidence instead of duplicating it.
 */
export interface KbFact {
  id: string;
  scope: KbScope;
  userId: string;
  kind: KbFactKind;
  subject: string;
  statement: string;
  detail?: string;
  key: string;
  confidence: number;
  firstSeenMs: number;
  lastSeenMs: number;
  evidence: KbEvidence[];
  updatedAt: number;
}

/**
 * A fact as the extractor emits it, before merge. Indexes refer to the batch.
 * `detail` is nullable rather than optional because strict structured output
 * requires every property to be present — see the schema in kb/extractor.ts.
 */
export interface KbFactDraft {
  kind: KbFactKind;
  subject: string;
  statement: string;
  detail?: string | null;
  confidence: number;
  evidenceIdx: number[];
}

/** A labelled cluster of chunks — the "themes" browse mode. */
export interface KbTopic {
  id: string;
  scope: KbScope;
  userId: string;
  label: string;
  summary: string;
  chunks: number;
  oldestMs: number;
  newestMs: number;
  updatedAt: number;
}

/** A cluster as computed, before it is written. */
export interface KbTopicDraft {
  label: string;
  summary: string;
  chunkIds: string[];
}

/** One principal's slice of one indexer cycle — rows for the activity timeline. */
export interface KbCycleEvent {
  id: string;
  cycleId: string;
  at: number;
  scope: KbScope;
  userId: string;
  source: "slack" | "gmail" | "synthesis" | "topics";
  outcome: "ok" | "skipped" | "auth_error" | "error";
  chunksUpserted: number;
  apiCalls: number;
  ms: number;
  /** Human-readable one-liner: "12 channels, 3 new windows". */
  detail?: string;
  error?: string;
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
  /**
   * Forget specific items from one source (e.g. Gmail message ids): delete
   * their excerpts, delete facts whose every piece of evidence was one of them,
   * and drop them from the evidence of facts that also rest on other items.
   */
  forgetSourceItems(
    scope: KbScope,
    userId: string,
    source: KbSource,
    sourceRefs: string[],
  ): Promise<{ excerptsRemoved: number; factsRemoved: number; factsTrimmed: number }>;

  getCursor(scope: KbScope, userId: string, source: string, stream: string): Promise<Record<string, unknown> | null>;
  setCursor(
    scope: KbScope,
    userId: string,
    source: string,
    stream: string,
    state: Record<string, unknown>,
  ): Promise<void>;

  getIndexState(scope: KbScope, userId: string, source: "slack" | "gmail"): Promise<KbIndexState | null>;
  setIndexState(state: KbIndexState): Promise<void>;
  listIndexStates(): Promise<KbIndexState[]>;

  // ── Distilled knowledge ────────────────────────────────────────────────────
  /** Merge drafts into stored facts: new key → insert, seen key → extend. */
  upsertFacts(
    scope: KbScope,
    userId: string,
    facts: Array<Omit<KbFact, "id" | "updatedAt" | "scope" | "userId">>,
    embeddings: number[][],
  ): Promise<{ created: number; updated: number }>;
  listFacts(
    scope: KbScope,
    userId: string,
    opts: { limit: number; offset: number; kind?: KbFactKind; subject?: string },
  ): Promise<{ items: KbFact[]; total: number; kinds: Array<{ kind: KbFactKind; count: number }> }>;
  /** Semantic search over facts — what the agent asks when it wants conclusions. */
  searchFacts(query: { scope: KbScope; userId: string; embedding: number[]; topK: number }): Promise<KbFact[]>;
  /** Oldest chunks not yet folded into a fact — the synthesis work queue. */
  pendingSynthesis(scope: KbScope, userId: string, limit: number): Promise<KbBrowseItem[]>;
  markSynthesized(chunkIds: string[]): Promise<void>;
  /** How much is still waiting to be distilled, per scope. */
  pendingSynthesisCount(scope: KbScope, userId: string): Promise<number>;

  // ── Topics (clustering) ────────────────────────────────────────────────────
  /** Replace this scope's clusters and reassign chunk→topic in one transaction. */
  replaceTopics(scope: KbScope, userId: string, topics: KbTopicDraft[]): Promise<void>;
  listTopics(scope: KbScope, userId: string): Promise<KbTopic[]>;
  chunksForTopic(scope: KbScope, userId: string, topicId: string, limit: number): Promise<KbBrowseItem[]>;
  /** Chunk id + embedding for clustering, newest first. */
  embeddingsForClustering(
    scope: KbScope,
    userId: string,
    limit: number,
  ): Promise<Array<{ id: string; text: string; source: KbSource; embedding: number[] }>>;

  // ── Activity ───────────────────────────────────────────────────────────────
  recordCycleEvents(events: Array<Omit<KbCycleEvent, "id">>): Promise<void>;
  /** Workspace events plus this user's own, newest first. */
  listCycleEvents(userId: string, limit: number): Promise<KbCycleEvent[]>;
}

// ── What not to learn from ────────────────────────────────────────────────────

/** Each person's "don't learn from" list. */
export interface DontLearnFromStore {
  get(userId: string): Promise<DontLearnFrom>;
  set(userId: string, value: DontLearnFrom): Promise<void>;
}

// ── Knowledge extraction ──────────────────────────────────────────────────────

/**
 * Turns raw chunks into knowledge. Separate from ChatModel because it returns
 * structured data rather than a conversational turn; the adapter runs it on the
 * configured provider via the AI SDK's schema-constrained generation.
 */
export interface KnowledgeExtractor {
  /** Distill one batch. Drafts reference chunks by their index in `chunks`. */
  extractFacts(input: {
    scope: KbScope;
    /** Display name of the private KB's owner, for correct framing. */
    owner?: string;
    chunks: Array<{ idx: number; source: KbSource; ts: number; text: string }>;
  }): Promise<KbFactDraft[]>;
  /** Name and summarize a cluster from a sample of its chunks. */
  labelTopic(input: { scope: KbScope; samples: string[] }): Promise<{ label: string; summary: string }>;
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
