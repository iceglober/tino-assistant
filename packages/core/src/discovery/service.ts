import { generateObject, type LanguageModel } from "ai";
import type { EmailPort } from "../privacy/ports.js";
import type { AppLogger } from "../slack/app.js";
import type { CalendarEvent, CalendarPort } from "./calendar-port.js";
import type { SlackDiscoveryPort } from "./slack-port.js";
import { DiscoveryAnalysisSchema, type DiscoveryProgress, type DiscoveryResult } from "./types.js";

const SYSTEM_PROMPT = `You are analyzing a user's email, calendar, and Slack data to build a profile for their personal AI assistant.

Answer each of these questions from the data. If the data doesn't support a confident answer, say so — don't fabricate.

IDENTITY:
- What is this person's job title and department?
- What is their primary function — what does the org pay them to do?

ORG RELATIONSHIPS:
- Who do they report to? (look for: 1:1 meetings titled "1:1" or "check-in" with one other person, especially someone senior)
- Who reports to them? (look for: 1:1s where they are likely the senior person, or team standups they run)
- Who are their closest peers? (frequent email, co-attendees on recurring meetings, Slack DM partners)
- Who are their key stakeholders outside their team? (cross-functional meetings, external email domains)
- For each person, note: how they interact (email, Slack, meetings), how often, and what about.

RESPONSIBILITIES:
- What do they do daily? (recurring daily meetings, Slack channel activity, email patterns)
- What do they do weekly? (weekly meetings, report cadences, sprint ceremonies)
- What do they do monthly/quarterly? (planning meetings, reviews, all-hands)
- What ongoing responsibilities show up across all time horizons? (ownership areas, tools they admin)
- For each responsibility, cite the evidence: which meetings, email threads, or Slack patterns support it.

COMMUNICATION STYLE:
- What channels do they use most? (email vs Slack vs meetings — compare relative volumes)
- Any observable patterns? (responds fast on Slack, batches email, prefers async, schedules everything)

WORK PATTERNS:
- How heavy is their meeting load? Count recurring meetings per week.
- Where does their time go? Estimate percentage split across meetings, async communication, and focus work.
- What recurring commitments anchor their week? (daily standup at 9am, weekly team sync on Tuesdays, etc.)

PAIN POINTS:
- What looks inefficient? (too many status meetings, context-switching between tools, manual processes)
- Where might they be overloaded? (back-to-back meetings, high email volume from certain contacts)
- What patterns suggest friction? (rescheduled meetings, unanswered threads, weekend email)

SUGGESTIONS:
- Based on the pain points, what could an AI assistant do to help?
- Be specific: "summarize the #engineering channel before your 10am standup" not "help with communication."`;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

const FETCH_TIMEOUT_MS = 15_000;

export interface DiscoveryServiceDeps {
  model: LanguageModel;
  email?: EmailPort;
  calendar?: CalendarPort;
  slack?: SlackDiscoveryPort;
  logger: AppLogger;
  onProgress?: (p: DiscoveryProgress) => void;
}

export async function runDiscovery(userId: string, deps: DiscoveryServiceDeps): Promise<DiscoveryResult> {
  const { model, email, calendar, slack, logger, onProgress } = deps;

  const dataPoints: string[] = [];
  const dataSourcesUsed: string[] = [];

  // Phase 1: Email contacts + labels + sample subjects
  if (email) {
    onProgress?.({ phase: "email", pct: 0, message: "Fetching email data..." });

    const [contacts, labels, samples] = await Promise.all([
      withTimeout(email.getContacts(userId, { sinceDays: 180 }), FETCH_TIMEOUT_MS, []),
      withTimeout(email.getLabels(userId), FETCH_TIMEOUT_MS, []),
      withTimeout(email.getSampleSubjects(userId, { maxPerLabel: 3 }), FETCH_TIMEOUT_MS, []),
    ]);

    if (contacts.length > 0) {
      dataSourcesUsed.push("email");
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

    onProgress?.({ phase: "email", pct: 20, message: "Email data collected" });
  }

  // Phase 2: Calendar events
  if (calendar) {
    onProgress?.({ phase: "calendar", pct: 25, message: "Fetching calendar data..." });

    const events = await withTimeout(
      calendar.getEvents(userId, { sinceDays: 180 }),
      FETCH_TIMEOUT_MS,
      [] as CalendarEvent[],
    );

    if (events.length > 0) {
      dataSourcesUsed.push("calendar");
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

    onProgress?.({ phase: "calendar", pct: 45, message: "Calendar data collected" });
  }

  // Phase 3: Slack activity
  if (slack) {
    onProgress?.({ phase: "slack", pct: 50, message: "Fetching Slack data..." });

    const [dmPartners, activeChannels, messageSample] = await Promise.all([
      withTimeout(slack.getTopDMPartners(userId, { sinceDays: 180, limit: 20 }), FETCH_TIMEOUT_MS, []),
      withTimeout(slack.getActiveChannels(userId, { sinceDays: 180, limit: 20 }), FETCH_TIMEOUT_MS, []),
      withTimeout(slack.getMessageSample(userId, { limit: 20 }), FETCH_TIMEOUT_MS, []),
    ]);

    if (dmPartners.length > 0 || activeChannels.length > 0 || messageSample.length > 0) {
      dataSourcesUsed.push("slack");
      dataPoints.push("\n## Slack activity (last 180 days)");

      if (dmPartners.length > 0) {
        dataPoints.push("\n### Top DM partners");
        for (const p of dmPartners) {
          dataPoints.push(`- ${p.name}: ${p.messageCount} messages`);
        }
      }

      if (activeChannels.length > 0) {
        dataPoints.push("\n### Active channels");
        for (const c of activeChannels) {
          dataPoints.push(`- ${c.name}: ${c.messageCount} messages`);
        }
      }

      if (messageSample.length > 0) {
        dataPoints.push("\n### Recent message sample (communication style reference)");
        for (const m of messageSample.slice(0, 10)) {
          dataPoints.push(`- "${m.text.length > 120 ? `${m.text.slice(0, 120)}…` : m.text}"`);
        }
      }
    }

    onProgress?.({ phase: "slack", pct: 60, message: "Slack data collected" });
  }

  if (dataPoints.length === 0) {
    logger.info({ userId }, "discovery: no data available");
    return {
      roleSummary: "No email, calendar, or Slack data was available to analyze.",
      inferredTitle: "Unknown",
      inferredDepartment: "Unknown",
      orgRelationships: [],
      responsibilities: [],
      communicationStyle: {
        summary: "No data available to analyze communication style.",
        preferredChannels: [],
        patterns: [],
      },
      workPatterns: {
        meetingLoad: "unknown",
        peakHours: "unknown",
        recurringCommitments: [],
        timeInvestment: [],
      },
      painPoints: [],
      suggestions: [],
      analyzedAt: Date.now(),
      dataSourcesUsed: [],
    };
  }

  // Phase 4: LLM analysis
  onProgress?.({ phase: "analysis", pct: 65, message: "Analyzing patterns..." });

  const prompt = [
    "Analyze the following data about a user's email, calendar, and Slack activity:",
    "",
    ...dataPoints,
  ].join("\n");

  logger.info({ userId, dataPointCount: dataPoints.length, dataSourcesUsed }, "discovery: running LLM analysis");

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
    dataSourcesUsed,
  };
}
