/**
 * Pure logic for the distilled-knowledge layer: how a claim gets its merge key,
 * and how chunks are grouped into themes. No I/O, no SDKs — the synthesizer
 * application service supplies the data and writes the results.
 */
import type { KbFactDraft, KbFactKind } from "../ports/outbound.js";

export const KB_FACT_KIND_SET: ReadonlySet<string> = new Set<KbFactKind>([
  "project",
  "person",
  "problem",
  "commitment",
  "decision",
  "preference",
  "fact",
]);

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "to", "of", "and", "or", "in",
  "on", "for", "with", "that", "this", "it", "as", "at", "by", "from", "has",
  "have", "had", "be", "been", "will", "would", "their", "they", "there",
]);

/**
 * Crude suffix stripping so inflections of the same word agree: blocking and
 * blocked both key as "block". Deliberately conservative — short words are left
 * alone, and a stem is only taken when what remains is still a real-looking
 * word, because a wrong merge is worse than a missed one.
 */
function stem(word: string): string {
  if (word.length <= 4) return word;
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (word.endsWith(suffix)) {
      const root = word.slice(0, -suffix.length);
      if (root.length >= 3) return root;
    }
  }
  return word;
}

/**
 * Slack user/channel ids and bare numbers carry no meaning in a label. The
 * digit lookahead matters: without it this also eats "deployment", "customer",
 * and "workflow", which are exactly the words a good label is made of.
 */
const isNoiseToken = (w: string): boolean =>
  /^\d+$/.test(w) || /^[ucdwg](?=[a-z0-9]*\d)[a-z0-9]{7,}$/.test(w);

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));

const slugWords = (text: string): string[] => tokenize(text).map(stem);

/**
 * Merge key for a fact. Two observations of the same claim should land on the
 * same key so the second extends the first rather than duplicating it, which
 * means dropping filler words and stable-sorting what remains: "sandbox creds
 * are blocking the Stedi POC" and "the Stedi POC is blocked on sandbox creds"
 * both key to `blocking-creds-poc-sandbox-stedi`.
 */
export function factKey(subject: string, statement: string): string {
  const words = [...new Set([...slugWords(subject), ...slugWords(statement)])].sort();
  const key = words.slice(0, 10).join("-");
  return key.length > 0 ? key.slice(0, 160) : "unnamed";
}

/** Reject drafts the model got structurally wrong rather than storing garbage. */
export function validateDraft(draft: KbFactDraft, batchSize: number): boolean {
  if (!KB_FACT_KIND_SET.has(draft.kind)) return false;
  if (draft.subject.trim().length === 0 || draft.subject.length > 120) return false;
  if (draft.statement.trim().length < 8 || draft.statement.length > 400) return false;
  if (draft.evidenceIdx.length === 0) return false;
  return draft.evidenceIdx.every((i) => Number.isInteger(i) && i >= 0 && i < batchSize);
}

// ── Clustering ────────────────────────────────────────────────────────────────

export interface Cluster {
  centroid: number[];
  members: number[];
}

const dot = (a: number[], b: number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number);
  return s;
};

function normalize(v: number[]): number[] {
  const n = Math.sqrt(dot(v, v));
  return n > 0 ? v.map((x) => x / n) : v;
}

/**
 * How many themes to ask for. Grows with the square root of the corpus so a
 * few hundred chunks give a handful of themes and a few thousand give a couple
 * of dozen — more than that stops reading as a summary.
 */
export function clusterCount(n: number, max = 18): number {
  if (n < 8) return Math.max(1, Math.min(n, 2));
  return Math.max(2, Math.min(max, Math.round(Math.sqrt(n / 2))));
}

/**
 * Spherical k-means (cosine). Seeding is farthest-point rather than random so
 * the same corpus always produces the same themes — a browse view that
 * reshuffles itself every cycle is not something you can read twice.
 */
export function kmeans(vectors: number[][], k: number, iterations = 12): Cluster[] {
  if (vectors.length === 0 || k < 1) return [];
  const pts = vectors.map(normalize);
  const kk = Math.min(k, pts.length);

  // Seed: first point, then repeatedly the point least similar to any seed.
  const seeds: number[][] = [pts[0] as number[]];
  while (seeds.length < kk) {
    let worstIdx = 0;
    let worstSim = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i] as number[];
      let best = Number.NEGATIVE_INFINITY;
      for (const s of seeds) best = Math.max(best, dot(p, s));
      if (best < worstSim) {
        worstSim = best;
        worstIdx = i;
      }
    }
    seeds.push(pts[worstIdx] as number[]);
  }

  let centroids = seeds;
  let assign: number[] = new Array(pts.length).fill(0);
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i] as number[];
      let bestC = 0;
      let bestSim = Number.NEGATIVE_INFINITY;
      for (let c = 0; c < centroids.length; c++) {
        const sim = dot(p, centroids[c] as number[]);
        if (sim > bestSim) {
          bestSim = sim;
          bestC = c;
        }
      }
      if (assign[i] !== bestC) moved = true;
      assign[i] = bestC;
    }
    const dims = (pts[0] as number[]).length;
    const sums = centroids.map(() => new Array<number>(dims).fill(0));
    const counts = new Array<number>(centroids.length).fill(0);
    for (let i = 0; i < pts.length; i++) {
      const c = assign[i] as number;
      const p = pts[i] as number[];
      const s = sums[c] as number[];
      for (let d = 0; d < dims; d++) s[d] = (s[d] as number) + (p[d] as number);
      counts[c] = (counts[c] as number) + 1;
    }
    centroids = centroids.map((old, c) => ((counts[c] as number) > 0 ? normalize(sums[c] as number[]) : old));
    if (!moved) break;
  }

  return centroids
    .map((centroid, c) => ({ centroid, members: assign.flatMap((a, i) => (a === c ? [i] : [])) }))
    .filter((cl) => cl.members.length > 0)
    .sort((a, b) => b.members.length - a.members.length);
}

/**
 * Name a cluster from its own most distinctive words, for when the labelling
 * call fails. A theme called "Sandbox Credentials Stedi" is worth far more than
 * a cluster silently dropped because the model would not answer.
 */
export function keywordLabel(samples: string[]): { label: string; summary: string } {
  const docFreq = new Map<string, number>();
  for (const s of samples) {
    for (const w of new Set(tokenize(s))) {
      if (w.length > 2 && !isNoiseToken(w)) docFreq.set(w, (docFreq.get(w) ?? 0) + 1);
    }
  }
  const top = [...docFreq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1));

  return {
    label: top.length > 0 ? top.join(" ") : "Unlabelled",
    summary: "Grouped by similarity; naming this theme was not possible, so these are its most common terms.",
  };
}

/**
 * Pick the chunks that best represent a cluster — the ones nearest its centre,
 * which is what you want to show a labelling model rather than an arbitrary
 * prefix that might all come from one thread.
 */
export function representatives(vectors: number[][], cluster: Cluster, n: number): number[] {
  return [...cluster.members]
    .map((i) => ({ i, sim: dot(normalize(vectors[i] as number[]), cluster.centroid) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, n)
    .map((x) => x.i);
}
