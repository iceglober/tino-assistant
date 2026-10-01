import type { ApprovalLevel, PlatformOAuthClient } from "@tino/core/domain/oauth-clients";
import { z } from "zod";

/**
 * Platform environment: what the *operator* of the managed service sets. Every
 * customer-facing setting — Slack app, Google client, model keys, policies —
 * belongs to an org and lives in its settings, never here.
 */
const approval = z.enum(["none", "verified", "assessed"]);

const EnvSchema = z.object({
  /** Public URL of the service, e.g. https://tino.app. Unset = http://localhost:$PORT. */
  BASE_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  NODE_ENV: z.string().optional(),

  /** Postgres with pgvector ≥ 0.7. Unset = PGlite on disk at PGLITE_DIR (local dev only). */
  DATABASE_URL: z.string().min(1).optional(),
  PGLITE_DIR: z.string().min(1).default("./.data/pglite"),

  /**
   * Master key for AES-256-GCM envelope encryption of every stored credential
   * and org secret. Required in production; changing it makes them unreadable.
   */
  ENCRYPTION_KEY: z.string().min(32).optional(),
  /** Signs sessions and OAuth state. Required in production. */
  AUTH_SECRET: z.string().min(32).optional(),

  /**
   * `open`: anyone who signs up can create an org. `closed` (a private beta):
   * anyone can still accept an invite or join by domain, but only
   * ORG_CREATORS may create new orgs.
   */
  SIGNUPS: z.enum(["open", "closed"]).default("open"),
  /** Comma-separated emails or @domains allowed to create orgs while SIGNUPS=closed. */
  ORG_CREATORS: z.string().default(""),

  /** Transactional email (verification, invites). Unset = links are logged instead of sent. */
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).default("Tino <hello@localhost>"),

  // ── Platform-managed OAuth clients (optional; see domain/oauth-clients.ts) ──
  /** Tino's own Google client. Used for "Sign in with Google" and, per its approval, data access. */
  PLATFORM_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  PLATFORM_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  /** none = unverified, verified = sensitive scopes (Calendar), assessed = restricted scopes + CASA (Gmail). */
  PLATFORM_GOOGLE_APPROVAL: approval.default("none"),
  /** Offer data access above the approval level to this many people (Google's unverified-app cap is 100). 0 = off. */
  PLATFORM_GOOGLE_PILOT_CAP: z.coerce.number().int().min(0).default(0),
  /** Tino's own distributable Slack app. Only worth offering once Marketplace-approved. */
  PLATFORM_SLACK_CLIENT_ID: z.string().min(1).optional(),
  PLATFORM_SLACK_CLIENT_SECRET: z.string().min(1).optional(),
  PLATFORM_SLACK_SIGNING_SECRET: z.string().min(1).optional(),
  PLATFORM_SLACK_APPROVAL: approval.default("none"),
  /** Comma-separated org ids that may use the platform clients. Unset = every org. */
  PLATFORM_CLIENT_ORGS: z.string().optional(),

  // ── Platform embeddings for orgs without their own embedding key (optional) ──
  PLATFORM_OPENAI_API_KEY: z.string().min(1).optional(),
  GOOGLE_VERTEX_PROJECT: z.string().min(1).optional(),
  GOOGLE_VERTEX_LOCATION: z.string().min(1).default("us-central1"),
  /** Set to 0 to stop every org's knowledge-base indexing (e.g. during an incident). */
  KB_ENABLED: z.enum(["0", "1"]).default("1"),
});

export type Env = z.infer<typeof EnvSchema>;

/** Treat `FOO=` (dotenv's empty string) as unset rather than as an invalid value. */
function stripEmpty(bag: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(bag)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

export function loadEnv(bag: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(stripEmpty(bag));
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Environment validation failed:\n${issues}\n\nSee .env.example.`);
  }
  const env = result.data;
  if (isProduction(env)) {
    const missing = (["DATABASE_URL", "ENCRYPTION_KEY", "AUTH_SECRET", "BASE_URL"] as const).filter((k) => !env[k]);
    if (missing.length > 0) throw new Error(`Production requires: ${missing.join(", ")}`);
  }
  return env;
}

export const isProduction = (env: Env): boolean => env.NODE_ENV === "production";
export const baseUrlOf = (env: Env): string => (env.BASE_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, "");

/** The platform's managed OAuth clients, as the policy in domain/oauth-clients.ts reads them. */
export function platformClients(env: Env): { google: PlatformOAuthClient | null; slack: PlatformOAuthClient | null } {
  const allowedOrgIds = env.PLATFORM_CLIENT_ORGS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const make = (
    clientId: string | undefined,
    clientSecret: string | undefined,
    level: ApprovalLevel,
    pilotCap = 0,
  ): PlatformOAuthClient | null =>
    clientId && clientSecret
      ? {
          clientId,
          clientSecret,
          approval: level,
          ...(pilotCap > 0 ? { pilot: { userCap: pilotCap } } : {}),
          ...(allowedOrgIds?.length ? { allowedOrgIds } : {}),
        }
      : null;
  return {
    google: make(
      env.PLATFORM_GOOGLE_CLIENT_ID,
      env.PLATFORM_GOOGLE_CLIENT_SECRET,
      env.PLATFORM_GOOGLE_APPROVAL,
      env.PLATFORM_GOOGLE_PILOT_CAP,
    ),
    slack: env.PLATFORM_SLACK_SIGNING_SECRET
      ? make(env.PLATFORM_SLACK_CLIENT_ID, env.PLATFORM_SLACK_CLIENT_SECRET, env.PLATFORM_SLACK_APPROVAL)
      : null,
  };
}

/** Who may create an org: everyone, or (closed beta) the ORG_CREATORS allowlist of emails and @domains. */
export function orgCreatorPolicy(env: Env): (email: string) => boolean {
  if (env.SIGNUPS === "open") return () => true;
  const entries = env.ORG_CREATORS.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return (email) => {
    const e = email.toLowerCase();
    return entries.some((entry) => (entry.startsWith("@") ? e.endsWith(entry) : e === entry));
  };
}
