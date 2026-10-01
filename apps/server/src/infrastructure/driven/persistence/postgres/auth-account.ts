/**
 * Raw read of better-auth's `account` table — the ported version of the inline
 * bun:sqlite query that syncGoogleCredentials used to run against the auth DB
 * file. better-auth's pg tables use quoted camelCase columns.
 */
import type { PgPool } from "./client.js";

export async function getGoogleRefreshTokenPg(pool: PgPool, betterAuthUserId: string): Promise<string | null> {
  try {
    const res = await pool.query<{ refreshToken: string | null }>(
      `SELECT "refreshToken" FROM "account" WHERE "userId" = $1 AND "providerId" = 'google' LIMIT 1`,
      [betterAuthUserId],
    );
    return res.rows[0]?.refreshToken ?? null;
  } catch {
    // Table may not exist yet on first boot before better-auth migrates.
    return null;
  }
}
