import { describe, expect, it, vi } from "vitest";
import { runPrivacyScan } from "../../src/privacy/scan-service.js";
import type { EmailPort, MessagingPort } from "../../src/privacy/ports.js";
import type { ScanProgress } from "../../src/privacy/scan-types.js";
import type { LanguageModel } from "ai";

function createMockModel(responses: Array<{ items: Array<{ id: string; sensitive: boolean; reason: string; confidence: string }> }>): LanguageModel {
  let callIndex = 0;
  return {
    doGenerate: async () => {
      const data = responses[callIndex++] ?? { items: [] };
      const text = JSON.stringify(data);
      return {
        text,
        content: [{ type: "text" as const, text }],
        finishReason: "stop" as const,
        usage: { inputTokens: 10, outputTokens: 10 },
        rawCall: { rawPrompt: "", rawSettings: {} },
        response: { id: "test", modelId: "test-model" },
        warnings: [],
      };
    },
    specificationVersion: "v2" as const,
    modelId: "test-model",
    provider: "test",
    defaultObjectGenerationMode: "json" as const,
  } as unknown as LanguageModel;
}

const mockEmail: EmailPort = {
  async getLabels() {
    return [
      { name: "Medical", itemCount: 18 },
      { name: "Work", itemCount: 200 },
    ];
  },
  async getContacts() {
    return [
      { address: "doctor@med.com", displayName: "Dr. Smith", itemCount: 14 },
      { address: "bob@work.com", displayName: "Bob", itemCount: 50 },
    ];
  },
  async getSampleSubjects() {
    return [
      { label: "Medical", subjects: ["Lab Results", "Rx Refill"] },
      { label: "Work", subjects: ["Sprint Planning"] },
    ];
  },
  async getContactSamples() {
    return [];
  },
};

const mockMessaging: MessagingPort = {
  async getDMs() {
    return [
      { id: "D001", participantId: "U1", participantName: "Alice", itemCount: 100 },
      { id: "D002", participantId: "U2", participantName: "HR Bot", itemCount: 10 },
    ];
  },
  async getDMSamples() {
    return [];
  },
};

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

describe("runPrivacyScan", () => {
  it("returns scan results with suggestions from all sources", async () => {
    const model = createMockModel([
      { items: [
        { id: "Medical", sensitive: true, reason: "medical content", confidence: "high" },
        { id: "Work", sensitive: false, reason: "work content", confidence: "high" },
      ] },
      { items: [
        { id: "doctor@med.com", sensitive: true, reason: "medical provider", confidence: "high" },
        { id: "bob@work.com", sensitive: false, reason: "colleague", confidence: "high" },
      ] },
      { items: [
        { id: "D001", sensitive: false, reason: "colleague", confidence: "high" },
        { id: "D002", sensitive: true, reason: "HR communications", confidence: "medium" },
      ] },
    ]);

    const result = await runPrivacyScan("user-1", {
      model,
      email: mockEmail,
      messaging: mockMessaging,
      logger,
    });

    expect(result.scannedAt).toBeGreaterThan(0);
    expect(result.email?.labels).toHaveLength(2);
    expect(result.email?.labels?.[0]).toEqual({
      id: "Medical", sensitive: true, reason: "medical content", confidence: "high",
    });
    expect(result.email?.contacts).toHaveLength(2);
    expect(result.messaging?.conversations).toHaveLength(2);
    expect(result.messaging?.conversations?.[1]).toEqual({
      id: "D002", sensitive: true, reason: "HR communications", confidence: "medium",
    });
  });

  it("emits progress events", async () => {
    const model = createMockModel([
      { items: [] },
      { items: [] },
      { items: [] },
    ]);

    const events: ScanProgress[] = [];

    await runPrivacyScan("user-1", {
      model,
      email: mockEmail,
      messaging: mockMessaging,
      logger,
      onProgress: (p) => events.push(p),
    });

    const phases = events.map((e) => e.phase);
    expect(phases).toContain("email-labels");
    expect(phases).toContain("email-contacts");
    expect(phases).toContain("messaging");
    expect(phases).toContain("done");
    expect(events[events.length - 1].pct).toBe(100);
  });

  it("works with email only (no messaging)", async () => {
    const model = createMockModel([
      { items: [{ id: "Medical", sensitive: true, reason: "medical", confidence: "high" }] },
      { items: [] },
    ]);

    const result = await runPrivacyScan("user-1", {
      model,
      email: mockEmail,
      logger,
    });

    expect(result.email).toBeDefined();
    expect(result.messaging).toBeUndefined();
  });

  it("works with messaging only (no email)", async () => {
    const model = createMockModel([
      { items: [{ id: "D001", sensitive: false, reason: "ok", confidence: "high" }] },
    ]);

    const result = await runPrivacyScan("user-1", {
      model,
      messaging: mockMessaging,
      logger,
    });

    expect(result.email).toBeUndefined();
    expect(result.messaging?.conversations).toHaveLength(1);
  });
});
