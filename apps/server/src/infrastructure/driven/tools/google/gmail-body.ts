/**
 * Gmail message-body extraction helpers, shared by the gmail_get_message tool
 * and the KB gmail indexer. Pure functions.
 */
import type { gmail_v1 } from "googleapis";

export function findPart(
  payload: gmail_v1.Schema$MessagePart | undefined,
  mimeType: string,
): gmail_v1.Schema$MessagePart | null {
  if (!payload) return null;
  if (payload.mimeType === mimeType) return payload;
  for (const part of payload.parts ?? []) {
    const found = findPart(part, mimeType);
    if (found) return found;
  }
  return null;
}

/**
 * Decode a base64url-encoded string to UTF-8 text.
 * Gmail uses URL-safe base64 (- and _ instead of + and /).
 */
export function decodeBase64Url(data: string): string {
  const standard = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(standard, "base64").toString("utf8");
}

/**
 * Strip HTML tags from a string. Basic — good enough for email body extraction.
 * Collapses whitespace runs to single spaces and trims.
 */
export function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Drop quoted reply tails — the #1 source of duplicate text in email corpora.
 * Cuts at the first "On … wrote:" / "-----Original Message-----" marker and
 * removes `>`-quoted lines. Operates on plain text (post stripHtmlTags is fine
 * for whitespace-collapsed inputs; for text/plain bodies line structure is kept).
 */
export function stripQuotedReply(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(trimmed)) break;
    if (/^On .{5,200} wrote:\s*$/.test(trimmed)) break;
    if (/^From:\s.+@.+/.test(trimmed) && out.length > 0) break; // forwarded header block
    if (trimmed.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Extract the best-effort plain-text body from a Gmail message payload. */
export function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return decodeBase64Url(plain.body.data);
  const html = findPart(payload, "text/html");
  if (html?.body?.data) return stripHtmlTags(decodeBase64Url(html.body.data));
  if (payload?.body?.data) return decodeBase64Url(payload.body.data);
  return "";
}
