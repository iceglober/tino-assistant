/**
 * Guards the shape of the extraction schemas against strict structured output.
 *
 * Azure/OpenAI reject a json_schema whose `required` array does not include
 * every key in `properties` — an `.optional()` field there fails 100% of calls
 * with "Invalid schema for response_format", which is exactly what happened on
 * the first deploy of this feature. Optionality must be expressed as
 * `.nullable()`, which keeps the key required while allowing a null value.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { factSchema, topicSchema } from "../../src/infrastructure/driven/kb/extractor.js";
import { isLikelyNoise } from "../../src/domain/knowledge.js";

/** Every property must reject `undefined` — i.e. none of them are optional. */
function expectNoOptionalFields(shape: Record<string, z.ZodTypeAny>, where: string): void {
  for (const [name, field] of Object.entries(shape)) {
    expect(field.safeParse(undefined).success, where + "." + name + " must not be optional").toBe(false);
  }
}

describe("extraction schemas are strict-structured-output safe", () => {
  const factItem = factSchema.shape.facts.element;

  it("no field on a fact is optional", () => {
    expectNoOptionalFields(factItem.shape as Record<string, z.ZodTypeAny>, "fact");
  });

  it("no field on a topic is optional", () => {
    expectNoOptionalFields(topicSchema.shape as Record<string, z.ZodTypeAny>, "topic");
  });

  it("detail is nullable, so the model can decline it without dropping the key", () => {
    expect(factItem.shape.detail.safeParse(null).success).toBe(true);
    expect(factItem.shape.detail.safeParse("some detail").success).toBe(true);
  });

  it("accepts a full model response", () => {
    const parsed = factSchema.safeParse({
      facts: [
        {
          kind: "problem",
          subject: "Stedi POC",
          statement: "Sandbox credentials are blocking the integration.",
          detail: null,
          confidence: 0.9,
          evidenceIdx: [0, 2],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an empty fact list — a batch of pure noise is a valid answer", () => {
    expect(factSchema.safeParse({ facts: [] }).success).toBe(true);
  });

  it("does not constrain numbers or array lengths in the schema itself", () => {
    // Bounds are enforced by validateDraft/clamping, because strict mode
    // rejects minimum/maximum/minItems outright.
    const outOfRange = factSchema.safeParse({
      facts: [
        {
          kind: "fact",
          subject: "s",
          statement: "a statement",
          detail: null,
          confidence: 42,
          evidenceIdx: [],
        },
      ],
    });
    expect(outOfRange.success).toBe(true);
  });
});

describe("isLikelyNoise", () => {
  it("flags bulk mail by its footer, sender, or platform", () => {
    expect(isLikelyNoise("gmail", "Big sale today! Unsubscribe here.")).toBe(true);
    expect(isLikelyNoise("gmail", "From: no-reply@example.com\nYour receipt")).toBe(true);
    expect(isLikelyNoise("gmail", "Sent via beehiiv to subscribers")).toBe(true);
    expect(isLikelyNoise("gmail", "You are receiving this email because you signed up")).toBe(true);
  });

  it("leaves real mail and all slack content alone", () => {
    expect(isLikelyNoise("gmail", "Hey — can you look at the sandbox creds today?")).toBe(false);
    expect(isLikelyNoise("slack_dm", "unsubscribe from what?")).toBe(false);
  });
});
