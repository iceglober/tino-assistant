import { createAzure } from "@ai-sdk/azure";
import { generateText, type ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { toChatModel } from "../../src/infrastructure/driven/model/chat-model.js";
import { replayableHistory } from "../../src/infrastructure/driven/model/replayable-history.js";

/** A past turn exactly as the Azure Responses adapter returns it: every part carries an itemId. */
const pastTurn: ModelMessage[] = [
  { role: "user", content: "what's on my calendar?" },
  {
    role: "assistant",
    content: [
      {
        type: "reasoning",
        text: "",
        providerOptions: { azure: { itemId: "rs_gone", reasoningEncryptedContent: null } },
      },
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "calendar_list_events",
        input: {},
        providerOptions: { azure: { itemId: "fc_gone" } },
      },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call_1",
        toolName: "calendar_list_events",
        output: { type: "json", value: { events: [] } },
      },
    ],
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "nothing today", providerOptions: { azure: { itemId: "msg_gone" } } }],
  },
];

/** Run a request through the real Azure adapter and capture the body it would send. */
async function requestBody(history: ModelMessage[]): Promise<{ input: Array<Record<string, unknown>> }> {
  let body: unknown;
  const azure = createAzure({
    resourceName: "test",
    apiKey: "k",
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "resp_1",
          created_at: 0,
          model: "m",
          object: "response",
          output: [
            {
              type: "message",
              id: "msg_new",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "ok", annotations: [] }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  await generateText({
    model: azure("deployment"),
    messages: [...history, { role: "user", content: "and tomorrow?" }],
  });
  return body as { input: Array<Record<string, unknown>> };
}

describe("replaying earlier turns", () => {
  it("unfixed, the adapter sends references to items the provider may have dropped", async () => {
    const body = await requestBody(pastTurn);
    expect(body.input.filter((i) => i.type === "item_reference").map((i) => i.id)).toEqual(["rs_gone", "msg_gone"]);
  });

  it("fixed, it sends the content itself — no references at all", async () => {
    const body = await requestBody(replayableHistory(pastTurn));
    expect(body.input.some((i) => i.type === "item_reference")).toBe(false);
    expect(JSON.stringify(body.input)).toContain("nothing today");
    expect(body.input.some((i) => i.type === "function_call" && i.call_id === "call_1")).toBe(true);
    expect(body.input.some((i) => i.type === "function_call_output" && i.call_id === "call_1")).toBe(true);
  });

  it("the chat model applies it, so a conversation with a dropped item still works", async () => {
    let body: { input: Array<Record<string, unknown>> } | undefined;
    const azure = createAzure({
      resourceName: "test",
      apiKey: "k",
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            id: "resp_2",
            created_at: 0,
            model: "m",
            object: "response",
            output: [
              {
                type: "message",
                id: "msg_2",
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: "tomorrow is free", annotations: [] }],
              },
            ],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const reply = await toChatModel(azure("deployment")).reply({
      system: "s",
      history: pastTurn,
      userText: "and tomorrow?",
      tools: {},
    });
    expect(reply.text).toBe("tomorrow is free");
    expect(body?.input.some((i) => i.type === "item_reference")).toBe(false);
  });

  it("keeps other provider options and plain-string messages; drops reasoning-only messages", () => {
    const out = replayableHistory([
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "reasoning", text: "x", providerOptions: { azure: { itemId: "rs" } } }] },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "yo",
            providerOptions: {
              azure: { itemId: "m", phase: "final" },
              anthropic: { cacheControl: { type: "ephemeral" } },
            },
          },
        ],
      },
    ]);
    expect(out).toEqual([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "yo",
            providerOptions: { azure: { phase: "final" }, anthropic: { cacheControl: { type: "ephemeral" } } },
          },
        ],
      },
    ]);
  });
});
