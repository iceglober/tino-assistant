/**
 * KnowledgeExtractor over the AI SDK. This is the only place that turns text
 * into claims, so the prompts that decide what counts as "knowledge" live here
 * rather than being scattered through the indexer.
 *
 * Structured output comes from a FORCED TOOL CALL, not `generateObject`.
 * `generateObject` sends `response_format: json_schema`, which only some
 * providers honour — the deployment this runs against (Kimi K2 on Azure AI
 * Foundry) accepts the parameter and then answers in prose, so every call
 * failed to parse. Tool calling is the mechanism the agent loop already uses
 * successfully on the same model, and it is near-universal across providers,
 * so the schema rides in as tool parameters instead. `ai@6` removed
 * generateObject's `mode: 'tool'` option, hence doing it by hand.
 *
 * The model never sees a user id and never chooses a scope — the caller has
 * already selected the corpus, and drafts can only cite chunks from the batch
 * they were given.
 */
import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { KbTruncatedOutputError } from "../../../domain/knowledge.js";
export { isLikelyNoise } from "../../../domain/knowledge.js";
import type { KbFactDraft, KbSource, KnowledgeExtractor, Logger } from "../../../ports/outbound.js";

/**
 * Nullable rather than optional: providers that DO enforce strict schemas
 * (Azure/OpenAI) reject any property missing from `required`, and reject
 * min/max/minItems outright. All bounds are enforced afterwards by
 * `validateDraft` and by clamping in the synthesizer.
 */
export const factSchema = z.object({
  facts: z
    .array(
      z.object({
        kind: z.enum(["project", "person", "problem", "commitment", "decision", "preference", "fact"]),
        subject: z
          .string()
          .describe("The thing this is about, e.g. 'Stedi POC'. Reuse an existing subject verbatim when it matches."),
        statement: z.string().describe("One sentence, self-contained, readable months later without the source open."),
        detail: z.string().nullable().describe("At most two sentences of specifics: names, numbers, dates. Null if none."),
        confidence: z.number().describe("Between 0 and 1."),
        evidenceIdx: z
          .array(z.number().int())
          .describe("Indexes of the numbered excerpts supporting this. At least one; never invent an index."),
      }),
    )
    .describe("At most 8 facts. Fewer and better is preferred; an empty list is a valid answer."),
});

export const topicSchema = z.object({
  label: z.string().describe("2–4 words, title case, specific to these excerpts."),
  summary: z.string().describe("One sentence on what this group of conversations is about."),
});

const SHARED_RULES = `
Write claims that stay true and useful after the conversation is forgotten.

DO record: what someone is working on and its current state; open problems and
blockers; decisions and why; commitments and who owes what to whom; how people
and teams relate; stable preferences and working habits.

DO NOT record: message summaries ("Ann sent a link"), one-off scheduling, the
contents of newsletters, marketing email, automated alerts, or CI noise. If an
excerpt is machine-generated or promotional, ignore it entirely.

Rules:
- One claim per fact. If a sentence needs "and", it is probably two facts.
- Cite every fact with the indexes of the excerpts that support it.
- Reuse an existing subject string exactly when the fact concerns the same
  thing, so related claims group together.
- Prefer fewer, better facts. Returning an empty list is correct when a batch
  is all noise.
- Never guess. If something is implied but not stated, leave it out.

Report your answer by calling the record_facts tool. Do not reply in prose.
`.trim();

/** Surface what the model actually said — "could not parse" alone is undebuggable. */
function describeError(err: unknown): Record<string, unknown> {
  const e = err as { message?: string; text?: string; cause?: { message?: string }; finishReason?: string };
  return {
    err: e.message,
    ...(e.text ? { modelText: e.text.slice(0, 300) } : {}),
    ...(e.cause?.message ? { cause: e.cause.message.slice(0, 200) } : {}),
    ...(e.finishReason ? { finishReason: e.finishReason } : {}),
  };
}

/**
 * Output budgets. This is a ceiling, not spend — and the deployment has the
 * final say: Azure Foundry clamps this model to 4096 output tokens whatever we
 * ask for, and a truncated answer yields NO tool call at all rather than a
 * partial one. The real lever is therefore how much text goes IN: each excerpt
 * is trimmed hard below, and the synthesizer retries with a smaller batch when
 * an answer still does not fit.
 */
const EXTRACT_MAX_TOKENS = 8_000;
const LABEL_MAX_TOKENS = 4_000;

/**
 * Excerpts are trimmed to this before extraction. A fact needs the gist, not
 * the full email — the stored evidence keeps a snippet and a permalink for
 * anyone who wants the original. Full-length excerpts reliably overran the
 * output ceiling; 800 chars reliably does not.
 */
const EXCERPT_MAX_CHARS = 800;

class NoToolCallError extends Error {
  constructor(toolName: string, finishReason: string, text: string) {
    super(
      "model did not call " +
        toolName +
        " (finishReason=" +
        finishReason +
        (text ? ", said: " + text.slice(0, 160) : "") +
        ")",
    );
    this.name = "NoToolCallError";
  }
}

export interface ExtractorDeps {
  model: LanguageModel;
  logger: Logger;
}

export function createKnowledgeExtractor({ model, logger }: ExtractorDeps): KnowledgeExtractor {
  /**
   * Ask for one forced tool call and return its arguments. `stopWhen` caps at a
   * single step so a chatty model cannot turn this into a conversation.
   */
  async function callForStructure<T>(opts: {
    toolName: string;
    description: string;
    schema: z.ZodType<T>;
    system: string;
    prompt: string;
    maxOutputTokens: number;
  }): Promise<T> {
    const result = await generateText({
      model,
      system: opts.system,
      prompt: opts.prompt,
      maxOutputTokens: opts.maxOutputTokens,
      stopWhen: stepCountIs(1),
      toolChoice: "required",
      tools: {
        [opts.toolName]: tool({ description: opts.description, inputSchema: opts.schema }),
      },
    });

    const call = result.toolCalls[0];
    if (!call) {
      if (result.finishReason === "length") {
        throw new KbTruncatedOutputError(
          opts.toolName + " answer exceeded the model's output limit (" + String(result.usage.outputTokens) + " tokens)",
        );
      }
      throw new NoToolCallError(opts.toolName, result.finishReason, result.text);
    }
    // Reasoning tokens are billed and invisible — log them so the running cost
    // of distillation is observable rather than inferred.
    logger.debug({ tool: opts.toolName, usage: result.usage }, "kb extraction call");
    return call.input as T;
  }

  return {
    async extractFacts(input): Promise<KbFactDraft[]> {
      const framing =
        input.scope === "private"
          ? [
              "You are building a durable profile of ONE person from their own",
              "Slack DMs, private channels, and email.",
              input.owner ? "That person is " + input.owner + "." : "",
              "Write facts about them and their world in the third person",
              '("they own the Stedi integration"), never addressed to them.',
              "Other people appear only in relation to them.",
            ]
              .filter(Boolean)
              .join(" ")
          : [
              "You are building a durable profile of a company and its work from",
              "its shared Slack channels. Write facts about the organization:",
              "its customers, projects, decisions, and who owns what.",
              "Do not write facts about any single individual's private life.",
            ].join(" ");

      const excerpts = input.chunks
        .map((c) => {
          const when = new Date(c.ts).toISOString().slice(0, 10);
          const body = c.text.length > EXCERPT_MAX_CHARS ? c.text.slice(0, EXCERPT_MAX_CHARS) + "…" : c.text;
          return ["[" + c.idx + "] (" + c.source + ", " + when + ")", body].join("\n");
        })
        .join("\n\n---\n\n");

      try {
        const out = await callForStructure({
          toolName: "record_facts",
          description: "Record the durable facts found in these excerpts.",
          schema: factSchema,
          system: [framing, SHARED_RULES].join("\n\n"),
          prompt: ["Numbered excerpts:", "", excerpts].join("\n"),
          maxOutputTokens: EXTRACT_MAX_TOKENS,
        });
        return out.facts as KbFactDraft[];
      } catch (err) {
        logger.warn({ ...describeError(err), scope: input.scope }, "fact extraction failed");
        throw err;
      }
    },

    async labelTopic(input) {
      try {
        return await callForStructure({
          toolName: "record_theme",
          description: "Record the single theme shared by these excerpts.",
          schema: topicSchema,
          system:
            "Name the single theme these excerpts share. Be concrete and specific to " +
            "this content — 'Stedi Integration' not 'Customer Work', 'Hiring Pipeline' " +
            "not 'Discussions'. No generic labels like 'General' or 'Miscellaneous'. " +
            "Always answer; if the excerpts are mixed, name the dominant thread. " +
            "Report your answer by calling the record_theme tool, not in prose.",
          prompt: input.samples.map((s, i) => "[" + i + "] " + s).join("\n\n---\n\n"),
          maxOutputTokens: LABEL_MAX_TOKENS,
        });
      } catch (err) {
        logger.warn({ ...describeError(err), scope: input.scope }, "topic labelling failed");
        throw err;
      }
    },
  };
}
