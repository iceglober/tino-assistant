import { betterAuth, type Auth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import Database from "better-sqlite3";

export async function createAuth(opts: {
  googleClientId: string;
  googleClientSecret: string;
  allowedDomain?: string;
  baseUrl: string;
  dbPath?: string;
}): Promise<Auth> {
  const auth = betterAuth({
    baseURL: opts.baseUrl,
    secret: process.env['BETTER_AUTH_SECRET'] ?? crypto.randomUUID(),
    database: new Database(opts.dbPath ?? "./tino-auth.db"),
    socialProviders: {
      google: {
        clientId: opts.googleClientId,
        clientSecret: opts.googleClientSecret,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24, // 24 hours
    },
  }) as unknown as Auth;

  // Auto-create tables on first run
  const { runMigrations } = await getMigrations((auth as any).options);
  await runMigrations();

  return auth;
}
