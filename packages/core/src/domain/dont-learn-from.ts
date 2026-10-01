/**
 * "Don't learn from": per-person exclusions that keep look-real-but-aren't mail
 * (domain warmup, bots) out of their knowledge base. Each source states them in
 * its own terms; Gmail's are labels and searches.
 *
 * Gmail decides what's noise — its filters run on delivery and leave labels —
 * and tino honours the outcome rather than re-implementing the rules. A filter
 * that only archives can still be used: its criteria become a search.
 *
 * Pure: no I/O.
 */

export type GmailExclusion =
  /** Everything carrying this label. Matched by id, so renaming the label doesn't break it. */
  | { kind: "gmailLabel"; labelId: string; name: string }
  /** Everything matching this Gmail search (often built from one of the person's filters). */
  | { kind: "gmailSearch"; query: string; name: string; fromFilterId?: string };

export interface DontLearnFrom {
  gmail: GmailExclusion[];
}

export const NOTHING_EXCLUDED: DontLearnFrom = { gmail: [] };

const MAX_EXCLUSIONS = 50;
const MAX_QUERY_LENGTH = 500;

/** The criteria half of a Gmail filter, as the Gmail API returns it. */
export interface GmailFilterCriteria {
  from?: string | null;
  to?: string | null;
  subject?: string | null;
  query?: string | null;
  negatedQuery?: string | null;
  hasAttachment?: boolean | null;
  size?: number | null;
  sizeComparison?: string | null;
}

/**
 * The Gmail search that matches what a filter matches. All of a filter's
 * criteria must hold, so they're joined with spaces (Gmail's AND). Null when
 * the filter has no criteria we can express.
 */
export function searchForGmailFilter(c: GmailFilterCriteria): string | null {
  const parts: string[] = [];
  if (c.from?.trim()) parts.push(`from:(${c.from.trim()})`);
  if (c.to?.trim()) parts.push(`to:(${c.to.trim()})`);
  if (c.subject?.trim()) parts.push(`subject:(${c.subject.trim()})`);
  if (c.query?.trim()) parts.push(`(${c.query.trim()})`);
  if (c.negatedQuery?.trim()) parts.push(`-(${c.negatedQuery.trim()})`);
  if (c.hasAttachment) parts.push("has:attachment");
  if (c.size && c.sizeComparison === "larger") parts.push(`larger:${c.size}`);
  if (c.size && c.sizeComparison === "smaller") parts.push(`smaller:${c.size}`);
  return parts.length > 0 ? parts.join(" ") : null;
}

/** A short human label for a filter: "from: warmup@x.com · subject: hello". */
export function describeGmailFilter(c: GmailFilterCriteria): string {
  const bits: string[] = [];
  if (c.from) bits.push(`from: ${c.from}`);
  if (c.to) bits.push(`to: ${c.to}`);
  if (c.subject) bits.push(`subject: ${c.subject}`);
  if (c.query) bits.push(`has the words: ${c.query}`);
  if (c.negatedQuery) bits.push(`doesn't have: ${c.negatedQuery}`);
  if (c.hasAttachment) bits.push("has attachment");
  if (c.size && c.sizeComparison) bits.push(`${c.sizeComparison} than ${c.size} bytes`);
  return bits.join(" · ") || "(no criteria)";
}

/** Terms to append to a Gmail search so excluded searches never come back. */
export function gmailSearchExcluding(d: DontLearnFrom): string {
  return d.gmail
    .filter((e): e is Extract<GmailExclusion, { kind: "gmailSearch" }> => e.kind === "gmailSearch")
    .map((e) => ` -(${e.query})`)
    .join("");
}

/** Label ids whose messages are skipped. */
export function excludedGmailLabelIds(d: DontLearnFrom): ReadonlySet<string> {
  return new Set(
    d.gmail
      .filter((e): e is Extract<GmailExclusion, { kind: "gmailLabel" }> => e.kind === "gmailLabel")
      .map((e) => e.labelId),
  );
}

/** Stable identity of an exclusion list — the indexer cleans up once per distinct list. */
export function exclusionsFingerprint(d: DontLearnFrom): string {
  return d.gmail
    .map((e) => (e.kind === "gmailLabel" ? `label:${e.labelId}` : `search:${e.query}`))
    .sort()
    .join("\n");
}

/** Validate and normalize input from the console. Returns an error message or the clean list. */
export function parseDontLearnFrom(input: unknown): DontLearnFrom | string {
  const gmail = (input as { gmail?: unknown })?.gmail;
  if (!Array.isArray(gmail)) return "gmail must be a list";
  if (gmail.length > MAX_EXCLUSIONS) return `at most ${MAX_EXCLUSIONS} exclusions`;
  const out: GmailExclusion[] = [];
  const seen = new Set<string>();
  for (const raw of gmail as Array<Record<string, unknown>>) {
    const name = typeof raw?.name === "string" ? raw.name.trim().slice(0, 200) : "";
    if (raw?.kind === "gmailLabel" && typeof raw.labelId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(raw.labelId)) {
      const key = `label:${raw.labelId}`;
      if (!seen.has(key)) out.push({ kind: "gmailLabel", labelId: raw.labelId, name: name || raw.labelId });
      seen.add(key);
    } else if (raw?.kind === "gmailSearch" && typeof raw.query === "string") {
      const query = raw.query.trim();
      if (!query) return "a search can't be empty";
      if (query.length > MAX_QUERY_LENGTH) return `a search can be at most ${MAX_QUERY_LENGTH} characters`;
      if (!balancedParens(query)) return `unbalanced parentheses in "${query}"`;
      const key = `search:${query}`;
      if (!seen.has(key)) {
        out.push({
          kind: "gmailSearch",
          query,
          name: name || query,
          ...(typeof raw.fromFilterId === "string" ? { fromFilterId: raw.fromFilterId } : {}),
        });
      }
      seen.add(key);
    } else {
      return "each exclusion is a Gmail label or a Gmail search";
    }
  }
  return { gmail: out };
}

/** A search is wrapped in -( … ); unbalanced parentheses would change what it excludes. */
function balancedParens(s: string): boolean {
  let depth = 0;
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch === "(") depth++;
    if (ch === ")" && --depth < 0) return false;
  }
  return depth === 0 && !quoted;
}
