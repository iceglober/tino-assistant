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

