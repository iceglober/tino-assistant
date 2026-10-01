/**
 * Tino on Railway — the whole platform is one service and one database.
 *
 *   railway link                  # once, in this repo
 *   bash scripts/railway-bootstrap.sh   # once per environment: generates the secrets
 *   railway config plan           # review
 *   railway config apply
 *
 * One replica on purpose: the knowledge-base scheduler runs in-process and
 * walks every org in turn. Slack events arrive over HTTP, so a second replica
 * is possible once the scheduler moves to a leader-elected worker (see
 * docs/managed-service.md → "Scaling past one box").
 *
 * Secrets the operator owns (ENCRYPTION_KEY, AUTH_SECRET, provider keys) are
 * `preserve()`d — IaC never writes or prints them, it only keeps what the
 * bootstrap script or the dashboard set. Customer credentials never live here:
 * every org's Slack app, Google client and model keys are in its own encrypted
 * settings.
 */
import { defineRailway, github, postgres, preserve, project, service } from "railway/iac";

export default defineRailway((ctx) => {
  const production = ctx.isEnvironment("production");
  // Postgres 18 with pgvector 0.8 — Railway's default Postgres image ships it.
  const db = postgres("postgres");

  const domain = process.env.TINO_DOMAIN; // e.g. tino.app — set when planning production
  const tino = service("tino", {
    source: github("iceglober/tino-assistant", { branch: "main" }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      watchPatterns: ["apps/**", "packages/**", "bun.lock", "Dockerfile"],
    },
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: 1,
    domains: domain && production ? [{ domain, port: 8080 }] : [],
    networking: { serviceDomains: { [production ? "tino" : `tino-${ctx.environment ?? "dev"}`]: { port: 8080 } } },
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5, drainingSeconds: 20 },
    env: {
      NODE_ENV: "production",
      PORT: "8080",
      LOG_LEVEL: "info",
      DATABASE_URL: db.env.DATABASE_URL,
      BASE_URL: domain && production ? `https://${domain}` : "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      SIGNUPS: production ? "closed" : "open",

      // Generated once by scripts/railway-bootstrap.sh; never rotated casually —
      // a new ENCRYPTION_KEY makes every stored credential unreadable.
      ENCRYPTION_KEY: preserve(),
      AUTH_SECRET: preserve(),

      // Optional platform settings, set in the dashboard when you have them.
      ORG_CREATORS: preserve(),
      RESEND_API_KEY: preserve(),
      EMAIL_FROM: preserve(),
      PLATFORM_GOOGLE_CLIENT_ID: preserve(),
      PLATFORM_GOOGLE_CLIENT_SECRET: preserve(),
      PLATFORM_GOOGLE_APPROVAL: preserve(),
      PLATFORM_GOOGLE_PILOT_CAP: preserve(),
      PLATFORM_OPENAI_API_KEY: preserve(),
    },
  });

  return project("tino", { resources: [db, tino] });
});
