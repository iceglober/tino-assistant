import type { ModelMessage } from "ai";

export interface HistoryStore {
  get(userId: string): Promise<ModelMessage[]>;
  append(userId: string, msgs: ModelMessage[]): Promise<void>;
  reset(userId: string): Promise<void>;
}

export function createHistoryStore({ cap = 40 }: { cap?: number } = {}): HistoryStore {
  const store = new Map<string, ModelMessage[]>();

  return {
    get(userId: string): Promise<ModelMessage[]> {
      return Promise.resolve(store.get(userId) ?? []);
    },

    append(userId: string, msgs: ModelMessage[]): Promise<void> {
      const existing = store.get(userId) ?? [];
      const combined = [...existing, ...msgs];
      store.set(userId, trim(combined, cap));
      return Promise.resolve();
    },

    reset(userId: string): Promise<void> {
      store.delete(userId);
      return Promise.resolve();
    },
  };
}

/**
 * Trim history to ≤ cap messages, removing the oldest first.
 *
 * Critical invariant: never orphan a `tool` role message from its preceding
 * `assistant` tool-call message. Bedrock's Converse API rejects message
 * arrays where a tool-result appears without its corresponding tool-call;
 * trimming naively from the front can produce that shape.
 *
 * Strategy: trim from the front, then advance past any leading orphan
 * `tool` messages. (An orphan `tool` is a tool-result whose preceding
 * `assistant` got trimmed away.)
 *
 * Note: AI SDK ModelMessage role 'system' is not expected mid-history —
 * we don't put a system message into the user-keyed store; the system
 * prompt is passed separately to `generateText({ system: ... })`.
 */
export function trim(messages: ModelMessage[], cap: number): ModelMessage[] {
  if (messages.length <= cap) return messages;

  let start = messages.length - cap;
  // Skip any leading orphan tool-result messages.
  while (start < messages.length && messages[start]?.role === "tool") {
    start += 1;
  }
  return messages.slice(start);
}
