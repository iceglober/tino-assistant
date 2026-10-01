/**
 * The HTTP contract between @tino/server and @tino/web.
 *
 * Shapes are what goes over the wire (dates as ISO strings or epoch ms as
 * documented). Every org-scoped path is under `/api/orgs/:slug`, and the
 * caller must be a member of that org; `admin` marks admin-only routes.
 * Errors are `{ error: string, message?: string }` with a 4xx/5xx status.
 */

// ── Platform + account ───────────────────────────────────────────────────────

/** GET /api/platform — public; what the sign-in and setup screens need to know. */
export interface PlatformInfo {
  baseUrl: string;
  signups: "open" | "closed";
  signIn: { email: true; google: boolean };
  /** True when sign-up needs the emailed link before an org can be created or joined. */
  emailVerification: boolean;
  /** What tino can connect with its own OAuth clients, for orgs that don't bring theirs. */
  managed: {
    google: { calendar: boolean; gmail: boolean; pilot: boolean };
    slack: boolean;
  };
  /** Whether a platform embedder exists for orgs with no embedding key of their own. */
  platformEmbeddings: boolean;
}

export interface OrgSummary {
  id: string;
  slug: string;
  name: string;
}

export type Role = "admin" | "member";
export type MemberStatus = "active" | "invited" | "suspended";

/** GET /api/me — 401 without a session. */
export interface Me {
  account: { id: string; email: string; name: string | null; emailVerified: boolean };
  memberships: Array<{ org: OrgSummary; role: Role; status: MemberStatus }>;
  /** Orgs whose join policy admits this address (verified email required to join). */
  joinable: OrgSummary[];
}

/** POST /api/orgs */
export interface CreateOrgBody {
  name: string;
  /** Optional; derived from the name when omitted. */
  slug?: string;
}
/** POST /api/orgs → 201 */
export type CreateOrgResponse = OrgSummary;
/** GET /api/orgs/slug-available?slug= */
export interface SlugAvailability {
  slug: string;
  available: boolean;
  problem?: string;
}

// ── Org overview ─────────────────────────────────────────────────────────────

/** The signed-in person as a member of this org. */
export interface OrgMember {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: MemberStatus;
  slackUserId: string | null;
}

/** What's set up, as booleans — readable by every member. */
export interface OrgSetupStatus {
  model: boolean;
  slack: { installed: boolean; teamId: string | null; client: "org" | "platform" | null };
  google: { available: boolean; client: "org" | "platform" | null; pilot: boolean; reason?: string };
  kb: { enabled: boolean; reason?: string; embedModel?: string };
}

/** GET /api/orgs/:slug */
export interface OrgOverview {
  org: OrgSummary;
  me: OrgMember;
  status: OrgSetupStatus;
  /** The signed-in member's own connections. */
  connections: { google: boolean; slack: boolean; mcpServers: number };
}

// ── Settings (admin) ─────────────────────────────────────────────────────────

export type SettingGroup = "model" | "slack" | "google" | "knowledge" | "assistant";

export interface SettingSpec {
  key: string;
  label: string;
  group: SettingGroup;
  /** Encrypted at rest and write-only: the API reports only whether it's set. */
  secret: boolean;
  help?: string;
  /** A closed set of values (rendered as a select). */
  options?: Array<{ value: string; label: string }>;
  kind?: "text" | "number";
  placeholder?: string;
}

/**
 * Every setting an admin may change, in display order. The server accepts
 * these keys only.
 */
export const SETTINGS: readonly SettingSpec[] = [
  {
    key: "model.provider",
    label: "Provider",
    group: "model",
    secret: false,
    options: [
      { value: "openai", label: "OpenAI" },
      { value: "anthropic", label: "Anthropic" },
      { value: "azure", label: "Azure OpenAI" },
    ],
  },
  { key: "openai.apiKey", label: "OpenAI API key", group: "model", secret: true, help: "Also used for knowledge-base embeddings." },
  { key: "openai.model", label: "OpenAI model", group: "model", secret: false, placeholder: "gpt-5.1" },
  { key: "anthropic.apiKey", label: "Anthropic API key", group: "model", secret: true },
  { key: "anthropic.model", label: "Anthropic model", group: "model", secret: false, placeholder: "claude-sonnet-5-5" },
  { key: "azure.apiKey", label: "Azure API key", group: "model", secret: true },
  { key: "azure.resourceName", label: "Azure resource name", group: "model", secret: false },
  { key: "azure.baseURL", label: "Azure base URL", group: "model", secret: false, help: "Instead of a resource name." },
  { key: "azure.deployment", label: "Azure chat deployment", group: "model", secret: false },
  { key: "azure.apiVersion", label: "Azure API version", group: "model", secret: false },
  {
    key: "azure.embeddingDeployment",
    label: "Azure embedding deployment",
    group: "model",
    secret: false,
    help: "A text-embedding-3-large deployment, for the knowledge base.",
  },

  { key: "slack.clientId", label: "Client ID", group: "slack", secret: false },
  { key: "slack.clientSecret", label: "Client secret", group: "slack", secret: true },
  { key: "slack.signingSecret", label: "Signing secret", group: "slack", secret: true },
  {
    key: "slack.mode",
    label: "Slack app",
    group: "slack",
    secret: false,
    options: [
      { value: "auto", label: "Ours if set up, else Tino's" },
      { value: "own", label: "Always our own app" },
      { value: "managed", label: "Prefer Tino's app" },
    ],
  },
  {
    key: "slack.channelMentions",
    label: "When @mentioned in a channel",
    group: "assistant",
    secret: false,
    options: [
      { value: "workspace", label: "Answer for everyone in the channel (safe)" },
      { value: "asker", label: "Answer for the asker (uses their private context)" },
    ],
  },

  { key: "google.oauth.clientId", label: "Client ID", group: "google", secret: false },
  { key: "google.oauth.clientSecret", label: "Client secret", group: "google", secret: true },
  {
    key: "google.oauth.mode",
    label: "Google client",
    group: "google",
    secret: false,
    options: [
      { value: "auto", label: "Ours if set up, else Tino's" },
      { value: "own", label: "Always our own client" },
      { value: "managed", label: "Prefer Tino's client" },
    ],
  },

  { key: "kb.recencyWeight", label: "Recency weight (0–1)", group: "knowledge", secret: false, kind: "number" },
  { key: "kb.recencyTauDays", label: "Recency half-life (days)", group: "knowledge", secret: false, kind: "number" },
];

export const SETTING_KEYS: ReadonlySet<string> = new Set(SETTINGS.map((s) => s.key));

/** GET /api/orgs/:slug/settings (admin) */
export interface SettingsView {
  /** Non-secret values that are set. */
  values: Record<string, string | number | boolean>;
  /** For every secret key: whether it's set. */
  secrets: Record<string, boolean>;
}
/** PUT /api/orgs/:slug/settings (admin). `null` deletes; secrets are write-only. */
export interface SettingsUpdate {
  values: Record<string, string | number | null>;
}

/** POST /api/orgs/:slug/settings/apply (admin) — rebuild the runtime from saved settings. */
export interface ApplyResult {
  ok: boolean;
  error?: string;
  status: OrgSetupStatus;
}

// ── Members (admin) ──────────────────────────────────────────────────────────

/** GET /api/orgs/:slug/users → { items } */
export interface ManagedUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: MemberStatus;
  slackLinked: boolean;
  /** What this person has connected for themselves. */
  connections: string[];
  createdAt: string;
}
/** POST /api/orgs/:slug/users */
export interface InviteBody {
  email: string;
  role: Role;
}
/** PATCH /api/orgs/:slug/users/:id */
export interface UserPatch {
  role?: Role;
  status?: "active" | "suspended";
}
/** GET|PUT /api/orgs/:slug/users/access */
export interface AccessPolicy {
  mode: "org-domain" | "invite-only";
  domain: string | null;
}

// ── Connections ──────────────────────────────────────────────────────────────

/**
 * GET /api/orgs/:slug/connections/google/start?access=mail|calendar → 302 to Google.
 * GET /api/orgs/:slug/connections/slack/start → 302 to Slack.
 * Both return to /<slug>/connections?connected=…|error=….
 */
export type GoogleAccess = "mail" | "calendar";

/** DELETE /api/orgs/:slug/connections/:provider — forget my token. */
export type ConnectionProvider = "google" | "slack";

/** GET /api/orgs/:slug/slack/setup (admin) */
export interface SlackSetup {
  /** The manifest to create the org's own Slack app with. */
  manifest: unknown;
  /** Slack's "create app from manifest" link. */
  createUrl: string;
  eventsUrl: string;
  redirectUrl: string;
  /** Which of the three values from the Slack app are saved. */
  saved: { clientId: boolean; clientSecret: boolean; signingSecret: boolean };
  installed: boolean;
  teamId: string | null;
  /** Whether tino's own Slack app may be used instead. */
  managedAvailable: boolean;
}
/** POST /api/orgs/:slug/slack/install (admin) → { url } to send the browser to. */
export interface InstallStart {
  url: string;
}

/** GET /api/orgs/:slug/google/setup (admin) */
export interface GoogleSetup {
  redirectUrl: string;
  /** Scopes the org's client must allow. */
  scopes: string[];
  saved: { clientId: boolean; clientSecret: boolean };
  /** What a new connection would use right now. */
  resolution: { mail: ResolutionView; calendar: ResolutionView };
}
export type ResolutionView =
  | { ok: true; client: "org" | "platform"; pilot: boolean }
  | { ok: false; reason: string; message: string };

// ── MCP servers ──────────────────────────────────────────────────────────────

export type McpScope = "workspace" | "personal";
export type McpAuthKind = "none" | "bearer" | "header";

export interface McpServer {
  id: string;
  scope: McpScope;
  name: string;
  url: string;
  transport: "http" | "sse";
  auth: { kind: McpAuthKind; headerName?: string };
  enabled: boolean;
  /** Workspace servers only: may everyone see results (usable in channels) or only the asker. */
  resultsVisibleTo: "asker" | "workspace";
  hasToken: boolean;
}
export interface McpServerInput {
  name?: string;
  url?: string;
  transport?: "http" | "sse";
  auth?: { kind: McpAuthKind; headerName?: string };
  /** Omit to keep the stored token; "" clears it. */
  token?: string;
  enabled?: boolean;
  resultsVisibleTo?: "asker" | "workspace";
}
/** GET /api/orgs/:slug/mcp/servers */
export interface McpServerList {
  canManageWorkspace: boolean;
  workspace: McpServer[];
  personal: McpServer[];
}
/** POST /api/orgs/:slug/mcp/test */
export interface McpTestResult {
  ok: boolean;
  tools?: string[];
  error?: string;
}

// ── Chat ─────────────────────────────────────────────────────────────────────

/** POST /api/orgs/:slug/chat { text } → { reply } */
export interface ChatReply {
  reply: string;
}

// ── Knowledge base ───────────────────────────────────────────────────────────

export type KbScope = "workspace" | "private";
export type KbFactKind = "project" | "person" | "problem" | "commitment" | "decision" | "preference" | "fact";

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

export interface KbScopeStats {
  chunks: number;
  oldestMs: number | null;
  newestMs: number | null;
  bySource: Array<{ source: string; chunks: number; newestMs: number | null }>;
  /** Indexed but not yet distilled into facts. */
  pending: number;
  facts: number;
}

export interface KbPrincipal {
  scope: KbScope;
  userId: string;
  source: "slack" | "gmail";
  status: "active" | "paused_auth" | "paused_error" | "disabled";
  backfillDone: boolean;
  lastCycleAt?: number;
  pausedAt?: number;
  lastError?: string;
}

/** GET /api/orgs/:slug/kb/status */
export interface KbStatus {
  enabled: boolean;
  /** Why it's off, when it is. */
  reason?: string;
  embedModel?: string;
  /** False when no model is configured — nothing can be distilled. */
  distilling?: boolean;
  indexer?: {
    running: boolean;
    intervalMs: number;
    startedAt?: number;
    nextRunAt?: number;
    lastCycle?: KbCycleSummary;
    cyclesCompleted: number;
  };
  scopes?: { workspace: KbScopeStats; private: KbScopeStats };
  principals?: KbPrincipal[];
}

export interface KbEvidence {
  source: string;
  ts: string;
  permalink?: string;
  snippet: string;
}

export interface KbFact {
  id: string;
  kind: KbFactKind;
  subject: string;
  statement: string;
  detail?: string;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  evidence: KbEvidence[];
}

/** GET /api/orgs/:slug/kb/knowledge?scope=&kind=&subject=&limit=&offset= */
export interface KbKnowledgePage {
  total: number;
  kinds: Array<{ kind: KbFactKind; count: number }>;
  items: KbFact[];
}

export interface KbTopic {
  id: string;
  label: string;
  summary: string;
  chunks: number;
  oldest: string | null;
  newest: string | null;
}

export interface KbItem {
  id?: string;
  text: string;
  source: string;
  sourceRef?: string;
  ts: string;
  permalink?: string;
  meta: Record<string, unknown>;
  indexedAt?: string;
  score?: number;
  sim?: number;
}

/** GET /api/orgs/:slug/kb/browse?scope=&q=&source=&limit=&offset= */
export interface KbBrowsePage {
  mode: "recent" | "search";
  total: number;
  items: KbItem[];
}

export interface KbActivityEvent {
  id: string;
  cycleId: string;
  at: string;
  scope: KbScope;
  userId: string;
  source: "slack" | "gmail" | "synthesis" | "topics";
  outcome: "ok" | "skipped" | "auth_error" | "error";
  chunksUpserted: number;
  apiCalls: number;
  ms: number;
  detail?: string;
  error?: string;
}

export type GmailExclusion =
  | { kind: "gmailLabel"; labelId: string; name: string }
  | { kind: "gmailSearch"; query: string; name: string; fromFilterId?: string };

/** GET /api/orgs/:slug/kb/dont-learn-from */
export interface DontLearnFromView {
  enabled?: false;
  exclusions: { gmail: GmailExclusion[] };
  gmailConnected: boolean;
  options: {
    labels: Array<{ id: string; name: string }>;
    filters: Array<{ id: string; description: string; query: string; labelIds: string[] }>;
  } | null;
  optionsError?: string;
}
/** PUT /api/orgs/:slug/kb/dont-learn-from { gmail } */
export interface DontLearnFromSaved {
  exclusions: { gmail: GmailExclusion[] };
  appliesBy: number | null;
}
