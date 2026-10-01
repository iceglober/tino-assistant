/**
 * A deliberately small Markdown subset for Tino's chat replies: paragraphs,
 * line breaks, bullet and numbered lists, headings, quotes, fenced code,
 * `code`, **bold**, *italic*, ~~strike~~, [links](https://…), Slack-style
 * <https://…|links> and bare URLs. Produces a tree (no HTML strings), so the
 * renderer never needs dangerouslySetInnerHTML.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "del"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };

export type Block =
  | { t: "p"; lines: Inline[][] }
  | { t: "h"; c: Inline[] }
  | { t: "quote"; lines: Inline[][] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "code"; lang: string; v: string };

/** Only links a browser can open safely. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*|__[^_\n]+?__)|(~~[^~\n]+?~~)|(\[[^\]\n]+\]\([^)\s]+\))|(<(?:https?:\/\/|mailto:)[^>|\s]+(?:\|[^>\n]+)?>)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]])|((?<![\w*])\*(?!\s)[^*\n]+?(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)[^_\n]+?(?<!\s)_(?![\w_]))/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (node: Inline): void => {
    const prev = out[out.length - 1];
    if (node.t === "text" && prev?.t === "text") prev.v += node.v;
    else out.push(node);
  };

  for (const m of src.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) push({ t: "text", v: src.slice(last, at) });
    const [whole, code, strong, del, mdLink, slackLink, bare, em] = m;
    if (code) push({ t: "code", v: code.slice(1, -1) });
    else if (strong) push({ t: "strong", c: parseInline(strong.slice(2, -2)) });
    else if (del) push({ t: "del", c: parseInline(del.slice(2, -2)) });
    else if (mdLink) {
      const split = mdLink.indexOf("](");
      const label = mdLink.slice(1, split);
      const href = safeHref(mdLink.slice(split + 2, -1));
      push(href ? { t: "link", href, c: parseInline(label) } : { t: "text", v: label });
    } else if (slackLink) {
      const [url = "", label] = slackLink.slice(1, -1).split("|");
      const href = safeHref(url);
      push(href ? { t: "link", href, c: [{ t: "text", v: label ?? url }] } : { t: "text", v: label ?? url });
    } else if (bare) {
      push({ t: "link", href: bare, c: [{ t: "text", v: bare }] });
    } else if (em) push({ t: "em", c: parseInline(em.slice(1, -1)) });
    else push({ t: "text", v: whole });
    last = at + whole.length;
  }
  if (last < src.length) push({ t: "text", v: src.slice(last) });
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const FENCE = /^\s*```\s*([\w+-]*)\s*$/;

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] ?? "")) body.push(lines[i++] ?? "");
      i++; // closing fence (or end of input)
      blocks.push({ t: "code", lang: fence[1] ?? "", v: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ t: "h", c: parseInline(heading[1] ?? "") });
      i++;
      continue;
    }

    if (BULLET.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && BULLET.test(lines[i] ?? "")) {
        items.push(parseInline(BULLET.exec(lines[i] ?? "")?.[1] ?? ""));
        i++;
      }
      blocks.push({ t: "ul", items });
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered) {
      const items: Inline[][] = [];
      while (i < lines.length && ORDERED.test(lines[i] ?? "")) {
        items.push(parseInline(ORDERED.exec(lines[i] ?? "")?.[2] ?? ""));
        i++;
      }
      blocks.push({ t: "ol", start: Number(ordered[1]) || 1, items });
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: Inline[][] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? "")) {
        quoted.push(parseInline(QUOTE.exec(lines[i] ?? "")?.[1] ?? ""));
        i++;
      }
      blocks.push({ t: "quote", lines: quoted });
      continue;
    }

    const para: Inline[][] = [];
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (!l.trim() || FENCE.test(l) || HEADING.test(l) || BULLET.test(l) || ORDERED.test(l) || QUOTE.test(l)) break;
      para.push(parseInline(l));
      i++;
    }
    blocks.push({ t: "p", lines: para });
  }
  return blocks;
}
