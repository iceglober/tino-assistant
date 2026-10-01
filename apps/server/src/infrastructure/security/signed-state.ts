/**
 * Short-lived, tamper-evident tokens that carry who started an OAuth round
 * trip — org, person, and what for — through the provider and back. The bot
 * DMs connect links containing one, so a member can connect without a console
 * session. HMAC-SHA256, not encryption: the payload is not secret, only
 * unforgeable and time-bound.
 */
import crypto from "node:crypto";

export type OAuthPurpose = "google.connect" | "slack.connect" | "slack.install";

export interface OAuthState {
  orgId: string;
  /** The tino user (membership) id. */
  userId: string;
  purpose: OAuthPurpose;
  /** Which client the round trip started with: the callback must finish with the same one. */
  client: "org" | "platform";
}

export interface SignedState {
  issue(state: OAuthState, ttlMs?: number): string;
  /** The state if the token is genuine and unexpired, else null. */
  verify(token: string): OAuthState | null;
}

const b64u = (b: Buffer): string => b.toString("base64url");
const PURPOSES = new Set<string>(["google.connect", "slack.connect", "slack.install"]);

export function createSignedState(secret: string): SignedState {
  const sign = (payload: string): string => b64u(crypto.createHmac("sha256", secret).update(payload).digest());

  return {
    issue(state, ttlMs = 15 * 60 * 1000) {
      const payload = b64u(Buffer.from(JSON.stringify({ ...state, e: Date.now() + ttlMs })));
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
        const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
        if (typeof s.e !== "number" || Date.now() > s.e) return null;
        if (typeof s.orgId !== "string" || typeof s.userId !== "string") return null;
        if (typeof s.purpose !== "string" || !PURPOSES.has(s.purpose)) return null;
        if (s.client !== "org" && s.client !== "platform") return null;
        return { orgId: s.orgId, userId: s.userId, purpose: s.purpose as OAuthPurpose, client: s.client };
      } catch {
        return null;
      }
    },
  };
}
