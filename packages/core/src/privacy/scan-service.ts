import { generateObject, type LanguageModel } from "ai";
import type { AppLogger } from "../slack/app.js";
import type { EmailPort, MessagingPort } from "./ports.js";
import { ScanBatchResultSchema, type ScanProgress, type ScanResult, type ScanSuggestion } from "./scan-types.js";

const BATCH_SIZE = 30;

const SYSTEM_PROMPT = [
  "You are a privacy classifier for a personal AI assistant.",
  "The user is setting up privacy controls. For each item, determine whether it likely",
  "contains sensitive personal information that should be deny-listed by default.",
  "",
  "Sensitive categories: medical/health, financial/tax, legal, HR/employment,",
  "mental health/therapy, romantic/family, account security, personal identity.",
  "",
  "For each item, return:",
  '- id: the exact identifier provided',
  "- sensitive: true if the item likely contains sensitive content",
  '- reason: one sentence explaining why (e.g. "Frequent contact with a medical provider")',
  "- confidence: high (clear signal), medium (likely but ambiguous), low (uncertain)",
  "",
  "Be opinionated — err on the side of flagging something as sensitive.",
  "A false positive (user unchecks) is far less costly than a false negative (private data persisted).",
].join("\n");

export interface ScanServiceDeps {
  model: LanguageModel;
  email?: EmailPort;
  messaging?: MessagingPort;
  logger: AppLogger;
  onProgress?: (p: ScanProgress) => void;
}

export async function runPrivacyScan(userId: string, deps: ScanServiceDeps): Promise<ScanResult> {
  const { model, email, messaging, logger, onProgress } = deps;
  const result: ScanResult = { scannedAt: Date.now() };

  if (email) {
    onProgress?.({ phase: "email-labels", pct: 0, message: "Fetching email data..." });

    const [labels, contacts, samples] = await Promise.all([
      email.getLabels(userId),
      email.getContacts(userId, { sinceDays: 180 }),
      email.getSampleSubjects(userId, { maxPerLabel: 5 }),
    ]);

    const sampleMap = new Map(samples.map((s) => [s.label, s.subjects]));

    onProgress?.({ phase: "email-labels", pct: 15, message: "Analyzing email labels..." });
    const labelItems = labels.map((l) => {
      const subj = sampleMap.get(l.name);
      const context = subj?.length ? `, samples: [${subj.map((s) => `"${s}"`).join(", ")}]` : "";
      return `id="${l.name}", ${l.itemCount} messages${context}`;
    });
    const labelSuggestions = await classifyBatch(model, "email labels", labelItems, logger);

    onProgress?.({ phase: "email-contacts", pct: 45, message: "Analyzing contacts..." });
    const contactItems = contacts.map((c) => {
      const name = c.displayName ? `, name="${c.displayName}"` : "";
      return `id="${c.address}"${name}, ${c.itemCount} messages in last 180 days`;
    });
    const contactSuggestions = await classifyBatch(model, "email contacts", contactItems, logger);

    result.email = { labels: labelSuggestions, contacts: contactSuggestions };
  }

  if (messaging) {
    onProgress?.({ phase: "messaging", pct: 70, message: "Analyzing conversations..." });

    const dms = await messaging.getDMs(userId);
    const dmItems = dms.map((d) => {
      const name = d.participantName ? `, participant="${d.participantName}"` : "";
      return `id="${d.id}"${name}, ${d.itemCount} messages`;
    });
    const dmSuggestions = await classifyBatch(model, "direct message conversations", dmItems, logger);

    result.messaging = { conversations: dmSuggestions };
  }

  onProgress?.({ phase: "done", pct: 100, message: "Scan complete" });
  return result;
}

async function classifyBatch(
  model: LanguageModel,
  category: string,
  items: string[],
  logger: AppLogger,
): Promise<ScanSuggestion[]> {
  if (items.length === 0) return [];

  const results: ScanSuggestion[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const numbered = batch.map((item, idx) => `${i + idx + 1}. ${item}`).join("\n");
    const prompt = `Classify these ${category}:\n${numbered}`;

    logger.debug({ category, batchStart: i, batchSize: batch.length }, "privacy scan: classifying batch");

    const { object } = await generateObject({
      model,
      schema: ScanBatchResultSchema,
      system: SYSTEM_PROMPT,
      prompt,
    });

    results.push(...object.items);
  }

  return results;
}
