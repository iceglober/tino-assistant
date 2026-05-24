import { generateObject, type LanguageModel } from "ai";
import type { AppLogger } from "../slack/app.js";
import type { EmailPort } from "../privacy/ports.js";
import type { CalendarEvent, CalendarPort } from "./calendar-port.js";
import { DiscoveryAnalysisSchema, type DiscoveryProgress, type DiscoveryResult } from "./types.js";

const SYSTEM_PROMPT = [
  "You are analyzing a user's email and calendar data to understand their role, responsibilities, and work patterns.",
  "Your goal is to produce a helpful profile that a personal AI assistant can use to be more effective.",
  "",
  "From the data provided, identify:",
  "1. The user's role and primary responsibilities (roleSummary)",
  "2. Their recurring duties — what they do regularly (duties)",
  "3. Their contacts grouped by category — team, leadership, vendors, etc. (contactCategories)",
  "4. Suggestions for how an AI assistant could help them (suggestions)",
  "",
  "Be specific and actionable. Base everything on the actual data — don't guess at things not supported by the evidence.",
  "Keep the roleSummary to 2-3 sentences. Each duty should be a concrete activity, not vague.",
].join("\n");

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const FETCH_TIMEOUT_MS = 15_000;

export interface DiscoveryServiceDeps {
  model: LanguageModel;
  email?: EmailPort;
  calendar?: CalendarPort;
  logger: AppLogger;
  onProgress?: (p: DiscoveryProgress) => void;
}

export async function runDiscovery(userId: string, deps: DiscoveryServiceDeps): Promise<DiscoveryResult> {
  const { model, email, calendar, logger, onProgress } = deps;

  const dataPoints: string[] = [];

  // Phase 1: Email contacts + labels + sample subjects
  if (email) {
    onProgress?.({ phase: "email", pct: 0, message: "Fetching email data..." });

    const [contacts, labels, samples] = await Promise.all([
      withTimeout(email.getContacts(userId, { sinceDays: 180 }), FETCH_TIMEOUT_MS, []),
      withTimeout(email.getLabels(userId), FETCH_TIMEOUT_MS, []),
      withTimeout(email.getSampleSubjects(userId, { maxPerLabel: 3 }), FETCH_TIMEOUT_MS, []),
    ]);

    if (contacts.length > 0) {
      const top = contacts.slice(0, 50);
      dataPoints.push("## Email contacts (last 180 days, sorted by frequency)");
      for (const c of top) {
        const name = c.displayName ? ` (${c.displayName})` : "";
        dataPoints.push(`- ${c.address}${name}: ${c.itemCount} messages`);
      }
    }

    if (labels.length > 0) {
      const sampleMap = new Map(samples.map((s) => [s.label, s.subjects]));
      dataPoints.push("\n## Email labels/folders");
      for (const l of labels) {
        const subjects = sampleMap.get(l.name);
        const examples = subjects?.length ? ` — examples: ${subjects.slice(0, 3).join(", ")}` : "";
        dataPoints.push(`- ${l.name}: ${l.itemCount} messages${examples}`);
      }
    }

    onProgress?.({ phase: "email", pct: 30, message: "Email data collected" });
  }

  // Phase 2: Calendar events
  if (calendar) {
    onProgress?.({ phase: "calendar", pct: 35, message: "Fetching calendar data..." });

    const events = await withTimeout(
      calendar.getEvents(userId, { sinceDays: 180 }),
      FETCH_TIMEOUT_MS,
      [] as CalendarEvent[],
    );

    if (events.length > 0) {
      dataPoints.push("\n## Calendar events (last 180 days)");

      // Group by recurrence to find patterns
      const recurring = new Map<string, { title: string; count: number; attendees: string[] }>();
      const oneOff: CalendarEvent[] = [];

      for (const e of events) {
        if (e.recurrence) {
          const key = e.title.toLowerCase();
          const existing = recurring.get(key);
          if (existing) {
            existing.count++;
          } else {
            recurring.set(key, { title: e.title, count: 1, attendees: e.attendees });
          }
        } else {
          oneOff.push(e);
        }
      }

      if (recurring.size > 0) {
        dataPoints.push("### Recurring meetings");
        for (const [, r] of [...recurring.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 20)) {
          const attendeeStr = r.attendees.length > 0 ? ` (with: ${r.attendees.slice(0, 5).join(", ")})` : "";
          dataPoints.push(`- "${r.title}": ${r.count} occurrences${attendeeStr}`);
        }
      }

      if (oneOff.length > 0) {
        dataPoints.push(`### One-off meetings: ${oneOff.length} total`);
        const sample = oneOff.slice(0, 15);
        for (const e of sample) {
          const attendeeStr = e.attendees.length > 0 ? ` (with: ${e.attendees.slice(0, 3).join(", ")})` : "";
          dataPoints.push(`- "${e.title}"${attendeeStr}`);
        }
      }
    }

    onProgress?.({ phase: "calendar", pct: 55, message: "Calendar data collected" });
  }

  if (dataPoints.length === 0) {
    logger.info({ userId }, "discovery: no data available");
    return {
      roleSummary: "No email or calendar data was available to analyze.",
      duties: [],
      contactCategories: [],
      suggestions: [],
      analyzedAt: Date.now(),
    };
  }

  // Phase 3: LLM analysis
  onProgress?.({ phase: "analysis", pct: 60, message: "Analyzing patterns..." });

  const prompt = [
    "Analyze the following data about a user's email and calendar activity:",
    "",
    ...dataPoints,
  ].join("\n");

  logger.info({ userId, dataPointCount: dataPoints.length }, "discovery: running LLM analysis");

  const { object } = await generateObject({
    model,
    schema: DiscoveryAnalysisSchema,
    system: SYSTEM_PROMPT,
    prompt,
  });

  onProgress?.({ phase: "done", pct: 100, message: "Discovery complete" });

  return {
    ...object,
    analyzedAt: Date.now(),
  };
}
