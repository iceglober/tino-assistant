/**
 * Who wrote an AI-SDK message and its readable text. Shared by the chat model
 * adapter and the one-time import of the old history table, so both label
 * messages the same way.
 */
import type { ModelMessage } from "ai";

export function describeModelMessage(message: unknown): {
  role: "user" | "assistant" | "tool" | "system";
  text: string | null;
} {
  const m = message as ModelMessage;
  if (m.role === "tool") return { role: "tool", text: null };
  const text =
    typeof m.content === "string"
      ? m.content
      : (m.content as Array<{ type: string; text?: string }>)
          .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
          .join("")
          .trim();
  return { role: m.role, text: text || null };
}
