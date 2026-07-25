/**
 * KnowledgeExtractor over the AI SDK's schema-constrained generation. This is
 * the only place that turns text into claims, so the prompts that decide what
 * counts as "knowledge" live here rather than being scattered through the
 * indexer.
 *
 * The model never sees a user id and never chooses a scope — the caller has
 * already selected the corpus, and drafts can only cite chunks from the batch
 * they were given.
 */
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { KbFactDraft, KbSource, KnowledgeExtractor, Logger } from "../../../ports/outbound.js";

/**
 * Written for the strictest provider, which is Azure/OpenAI structured output:
 * every property must appear in `required`, and min/max/minItems constraints
 * are rejected outright. So optionality is expressed as `.nullable()` and all
 * bounds are enforced afterwards by `validateDraft`. Using `.optional()` here
 * fails every single call with "Invalid schema for response_format".
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
    .describe("At most 12 facts. Fewer and better is preferred; an empty list is a valid answer."),
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

export interface ExtractorDeps {
  model: LanguageModel;
  logger: Logger;
}

export function createKnowledgeExtractor({ model, logger }: ExtractorDeps): KnowledgeExtractor {
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
          return ["[" + c.idx + "] (" + c.source + ", " + when + ")", c.text].join("\n");
        })
        .join("\n\n---\n\n");

      try {
        const { object } = await generateObject({
          model,
          schema: factSchema,
          system: [framing, SHARED_RULES].join("\n\n"),
          prompt: ["Numbered excerpts:", "", excerpts].join("\n"),
        });
        return object.facts as KbFactDraft[];
      } catch (err) {
        logger.warn({ ...describeError(err), scope: input.scope }, "fact extraction failed");
        throw err;
      }
    },

    async labelTopic(input) {
      try {
        const { object } = await generateObject({
          model,
          schema: topicSchema,
          system:
            "Name the single theme these excerpts share. Be concrete and specific to " +
            "this content — 'Stedi Integration' not 'Customer Work', 'Hiring Pipeline' " +
            "not 'Discussions'. No generic labels like 'General' or 'Miscellaneous'. " +
            "Always answer; if the excerpts are mixed, name the dominant thread.",
          prompt: input.samples.map((s, i) => "[" + i + "] " + s).join("\n\n---\n\n"),
        });
        return object;
      } catch (err) {
        logger.warn({ ...describeError(err), scope: input.scope }, "topic labelling failed");
        throw err;
      }
    },
  };
}

/** Sources whose content is almost always machine-generated bulk mail. */
export const isLikelyNoise = (source: KbSource, text: string): boolean => {
  if (source !== "gmail") return false;
  const head = text.slice(0, 600).toLowerCase();
  return /unsubscribe|view (this )?email in your browser|manage (your )?preferences|no-?reply@/.test(head);
};
