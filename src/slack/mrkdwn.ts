/**
 * Convert standard Markdown to Slack mrkdwn before posting.
 *
 * Slack's mrkdwn is similar to Markdown but with several incompatible
 * differences. The system prompt asks Claude to format in mrkdwn natively,
 * but Claude defaults to Markdown habits and slips occasionally — so we
 * normalize on the way out as defense in depth.
 *
 * Conversions:
 * - **bold** → *bold*
 * - __bold__ → *bold* (rare; Markdown also accepts this)
 * - ATX headers (# Header, ## Header, etc.) → *Header*
 * - Markdown links [text](url) → <url|text> (Slack's link syntax)
 *
 * NOT converted (these are already valid in both dialects):
 * - `inline code` → unchanged
 * - ```code blocks``` → unchanged
 * - _italic_ → unchanged
 * - ~~strike~~ → ~strike~ (Markdown's double-tilde becomes single-tilde)
 * - bullet lists with -, *, or • → unchanged (Slack accepts all three)
 * - numbered lists 1. 2. 3. → unchanged
 *
 * Limitations:
 * - Code blocks and inline code are NOT excluded from substitution. If
 *   Claude writes `**foo**` inside a code block, this will still convert
 *   it to `*foo*`. In practice this is rare and the alternative (a real
 *   Markdown parser) is overkill for a personal tool.
 * - Nested bold/italic combinations may produce weird output. We don't
 *   worry about it — Claude almost never nests these.
 */
export function toSlackMrkdwn(text: string): string {
  return text
    // Headers: # Header → *Header* (and strip the # prefix)
    // Match start-of-line, 1-6 # chars, optional space, then the header text.
    .replace(/^(#{1,6})\s+(.+)$/gm, '*$2*')
    // Bold: **foo** → *foo*. Use a lazy match to avoid swallowing across
    // multiple bold spans on the same line.
    .replace(/\*\*([^*\n]+?)\*\*/g, '*$1*')
    // Bold (alt): __foo__ → *foo*
    .replace(/__([^_\n]+?)__/g, '*$1*')
    // Strike: ~~foo~~ → ~foo~
    .replace(/~~([^~\n]+?)~~/g, '~$1~')
    // Links: [text](url) → <url|text>
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');
}
