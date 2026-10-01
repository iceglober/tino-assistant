/** Small pure formatting helpers (unit-tested in format.test.ts). */
import { isApiError } from "./api";

type When = string | number | null | undefined;

const toMs = (v: When): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const ms = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};

/** "just now", "5m ago", "3h ago", "2d ago" — or "in 4m" for the future. */
export function fmtAgo(v: When, now: number = Date.now()): string {
  const ms = toMs(v);
  if (ms === null) return "—";
  const diff = now - ms;
  const mins = Math.round(Math.abs(diff) / 60_000);
  const span =
    mins < 1
      ? null
      : mins < 60
        ? `${mins}m`
        : mins < 1440
          ? `${Math.round(mins / 60)}h`
          : `${Math.round(mins / 1440)}d`;
  if (!span) return diff >= 0 ? "just now" : "any moment";
  return diff >= 0 ? `${span} ago` : `in ${span}`;
}

export function fmtDate(v: When): string {
  const ms = toMs(v);
  if (ms === null) return "—";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function fmtDateTime(v: When): string {
  const ms = toMs(v);
  if (ms === null) return "—";
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "Mar 2, 2026 → Apr 9, 2026", or one date when both are the same day. */
export function fmtRange(from: When, to: When): string {
  const a = toMs(from);
  const b = toMs(to);
  if (a === null || b === null) return "—";
  const da = fmtDate(a);
  const db = fmtDate(b);
  return da === db ? da : `${da} → ${db}`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function fmtNumber(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString();
}

/** plural(3, "fact") → "3 facts"; plural(1, "query", "queries") → "1 query". */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** A URL-safe slug, as the server derives one from an org name. */
export function slugify(s: string, max = 40): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export function initials(nameOrEmail: string): string {
  const base = nameOrEmail.includes("@") ? (nameOrEmail.split("@")[0] ?? "") : nameOrEmail;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0]?.[0]}${parts[1]?.[0]}` : base.slice(0, 2);
  return letters.toUpperCase() || "?";
}

/** First name for a greeting: "Austin Rivera" → "austin"; falls back to the email's local part. */
export function firstName(name: string | null | undefined, email: string): string {
  const n = name?.trim().split(/\s+/)[0];
  return (n || email.split("@")[0] || "there").toLowerCase();
}

/** The email domain, for "anyone @acme.com" copy. */
export function emailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

const KNOWN_ERRORS: Record<string, string> = {
  verify_email: "confirm your email address first — check your inbox for the link.",
  closed_beta: "tino is in private beta — ask your team's admin for an invite.",
  network: "can't reach tino — check your connection and try again.",
  unauthorized: "your session ended — sign in again.",
};

/** A sentence for any thrown value, preferring the server's own message. */
export function errorMessage(err: unknown): string {
  if (isApiError(err)) {
    if (KNOWN_ERRORS[err.error] && (!err.message || err.message === err.error)) return KNOWN_ERRORS[err.error] ?? "";
    if (err.message && err.message !== err.error) return err.message;
    if (err.status === 403) return "you don't have access to that.";
    if (err.status === 404) return "that doesn't exist, or you aren't a member here.";
    if (err.status >= 500) return "tino hit a snag on its side. try again in a moment.";
    return err.message || "something went wrong.";
  }
  if (err instanceof Error) return err.message;
  return "something went wrong.";
}
