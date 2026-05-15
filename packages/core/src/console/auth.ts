import { betterAuth, type Auth } from "better-auth";
import Database from "better-sqlite3";

export function createAuth(opts: {
  googleClientId: string;
  googleClientSecret: string;
  allowedDomain?: string;
  baseUrl: string;
  dbPath?: string;
}): Auth {
  return betterAuth({
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
}
