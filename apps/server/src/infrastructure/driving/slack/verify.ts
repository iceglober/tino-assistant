/**
 * Slack request signing (v0): HMAC-SHA256 over `v0:<timestamp>:<raw body>`
 * with the app's signing secret, compared in constant time, and refused when
 * the timestamp is more than five minutes off (replay protection).
 */
import crypto from "node:crypto";

const MAX_SKEW_SECONDS = 60 * 5;

export function verifySlackSignature(opts: {
  signingSecret: string;
  rawBody: string;
  timestamp: string | undefined;
  signature: string | undefined;
  nowMs?: number;
}): boolean {
  const { signingSecret, rawBody, timestamp, signature } = opts;
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) return false;
  const expected = `v0=${crypto.createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Slack sends events as JSON, and interactivity as a form with a `payload` field. */
export function parseSlackBody(rawBody: string, contentType: string | undefined): Record<string, unknown> | null {
  try {
    if (contentType?.includes("application/x-www-form-urlencoded")) {
      const form = new URLSearchParams(rawBody);
      const payload = form.get("payload");
      return payload ? (JSON.parse(payload) as Record<string, unknown>) : Object.fromEntries(form);
    }
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }
}
