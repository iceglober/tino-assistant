/**
 * Earlier turns, made safe to send again.
 *
 * The OpenAI/Azure Responses adapter, with `store` on (its default), sends a
 * past reply's text, tool calls, and reasoning as *references* to items it
 * assumes the provider still has saved (`providerOptions.<provider>.itemId`).
 * When the provider has dropped an item — retention expiry, a different
 * deployment, a history imported from elsewhere — every request built on that
 * history fails with "Item with id '…' not found", and keeps failing, because
 * the same history is replayed on every message.
 *
 * So earlier turns are sent as plain content: provider item ids are removed,
 * and past reasoning (which the model doesn't need again, and which can only be
 * sent by reference) is dropped. The current turn's own tool loop is untouched.
 */
import type { ModelMessage } from "ai";

type Part = { type: string; providerOptions?: Record<string, Record<string, unknown> | undefined> };

function withoutItemIds<T extends { providerOptions?: Part["providerOptions"] }>(x: T): T {
  if (!x.providerOptions) return x;
  const providerOptions: NonNullable<Part["providerOptions"]> = {};
  for (const [provider, options] of Object.entries(x.providerOptions)) {
    if (!options) continue;
    const { itemId: _dropped, ...rest } = options;
    if (Object.keys(rest).length > 0) providerOptions[provider] = rest;
  }
  const { providerOptions: _old, ...base } = x;
  return (Object.keys(providerOptions).length > 0 ? { ...base, providerOptions } : base) as T;
}

export function replayableHistory(history: readonly ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const message of history) {
    if (typeof message.content === "string") {
      out.push(withoutItemIds(message as ModelMessage & Part) as ModelMessage);
      continue;
    }
    const parts = (message.content as Part[]).filter((p) => p.type !== "reasoning").map((p) => withoutItemIds(p));
    // An assistant message that was only reasoning has nothing left to say.
    if (parts.length === 0) continue;
    out.push(withoutItemIds({ ...message, content: parts } as ModelMessage & Part) as ModelMessage);
  }
  return out;
}
