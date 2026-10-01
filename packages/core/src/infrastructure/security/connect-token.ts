/**
 * Short-lived signed tokens that carry a tino userId through the Slack OAuth
 * round-trip. The bot DMs a connect link containing one of these; the OAuth
 * routes verify it — so a workspace member can connect without being logged
 * into the console. HMAC-SHA256 (not encryption); the payload is not secret,
 * only tamper-evident and time-bound.
 */
import crypto from "node:crypto";

export interface ConnectTokens {
  /** Issue a token binding `userId`, valid for `ttlMs` (default 15 min). */
  issue(userId: string, ttlMs?: number): string;
  /** Return the userId if the token is valid and unexpired, else null. */
  verify(token: string): string | null;
}

const b64u = (b: Buffer): string => b.toString("base64url");

export function createConnectTokens(secret: string): ConnectTokens {
  const sign = (payload: string): string => b64u(crypto.createHmac("sha256", secret).update(payload).digest());

  return {
    issue(userId, ttlMs = 15 * 60 * 1000) {
      const payload = b64u(Buffer.from(JSON.stringify({ u: userId, e: Date.now() + ttlMs })));
      return `${payload}.${sign(payload)}`;
    },

    verify(token) {
      const [payload, sig] = token.split(".");
      if (!payload || !sig) return null;
      const expected = sign(payload);
      if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return null;
      }
      try {
        const { u, e } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: unknown; e: unknown };
        if (typeof u !== "string" || typeof e !== "number" || Date.now() > e) return null;
        return u;
      } catch {
        return null;
      }
    },
  };
}
