import type { LanguageModel } from "ai";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { PrivacyConfigStore } from "../../privacy/config-store.js";
import { withDefaults } from "../../privacy/defaults.js";
import type { CalendarPort, EmailPort, MessagingPort } from "../../privacy/ports.js";
import { runPrivacyScan } from "../../privacy/scan-service.js";
import type { PrivacyConfig } from "../../privacy/types.js";
import { createMockScanResult } from "../../privacy/adapters/mock.js";
import type { UserCapabilityStore } from "../../persistence/user-capabilities.js";
import type { ConfigStore } from "../../persistence/config.js";
import type { AppLogger } from "../../slack/app.js";
import type { AuthVariables } from "../middleware/auth.js";

export interface PrivacyRouteDeps {
  privacyConfigStore: PrivacyConfigStore;
  logger: AppLogger;
  userCapabilities?: UserCapabilityStore;
  configStore?: ConfigStore;
  email?: EmailPort;
  calendar?: CalendarPort;
  messaging?: MessagingPort;
  model?: LanguageModel;
  mockMode?: boolean;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function validateEmail(v: unknown): v is { privateFolders: string[]; denyListedAddresses: string[] } {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return isStringArray(o.privateFolders) && isStringArray(o.denyListedAddresses);
}

function validateMessaging(v: unknown): v is { denyListedConversationIds: string[]; denyListedUserIds: string[] } {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return isStringArray(o.denyListedConversationIds) && isStringArray(o.denyListedUserIds);
}

const VALID_VISIBILITIES = new Set(["default", "public", "private"]);

function validateCalendar(v: unknown): v is { defaultVisibility: string; gateAllByDefault: boolean } {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.defaultVisibility === "string" && VALID_VISIBILITIES.has(o.defaultVisibility) && typeof o.gateAllByDefault === "boolean";
}

export function createPrivacyRoutes(deps: PrivacyRouteDeps): Hono<{ Variables: AuthVariables }> {
  const { privacyConfigStore, logger } = deps;
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/status", async (c) => {
    const user = c.get("user");
    const config = await privacyConfigStore.get(user.id);

    let connectedCapabilities: string[];

    if (deps.mockMode) {
      connectedCapabilities = ["gmail", "calendar", "slack-personal"];
    } else if (deps.userCapabilities) {
      connectedCapabilities = [];
      const caps = await deps.userCapabilities.list(user.id);
      for (const cap of caps) {
        if (!cap.enabled) continue;
        const cfg = await deps.userCapabilities.get(user.id, cap.capabilityId);
        if (cfg?.credentials && Object.values(cfg.credentials).some((v) => !!v)) {
          connectedCapabilities.push(cap.capabilityId);
        }
      }
    } else if (deps.configStore) {
      connectedCapabilities = [];
      for (const capId of ["gmail", "calendar", "slack-personal"]) {
        const raw = await deps.configStore.get(`user.${user.id}.capability.${capId}`);
        if (!raw) continue;
        try {
          const cfg = JSON.parse(raw) as { credentials?: Record<string, string> };
          if (cfg.credentials && Object.values(cfg.credentials).some((v) => !!v)) {
            connectedCapabilities.push(capId);
          }
        } catch { /* malformed config */ }
      }
    } else {
      connectedCapabilities = [];
    }

    return c.json({
      connectedCapabilities,
      hasPrivacyConfig: config != null,
      existingConfig: config,
    });
  });

  app.get("/email/labels", async (c) => {
    const user = c.get("user");
    if (!deps.email) return c.json({ labels: [], message: "email not connected" });
    const [labels, samples] = await Promise.all([
      deps.email.getLabels(user.id),
      deps.email.getSampleSubjects(user.id, { maxPerLabel: 3 }),
    ]);
    const sampleMap = new Map(samples.map((s) => [s.label, s.subjects]));
    const enriched = withDefaults(labels, "name").map((l) => ({
      ...l,
      examples: sampleMap.get(l.name) ?? [],
    }));
    return c.json({ labels: enriched });
  });

  app.get("/email/contacts", async (c) => {
    const user = c.get("user");
    if (!deps.email) return c.json({ contacts: [], message: "email not connected" });
    const contacts = await deps.email.getContacts(user.id, { sinceDays: 180 });
    const addresses = contacts.map((c) => c.address);
    const [withDefs, contactSamples] = await Promise.all([
      Promise.resolve(withDefaults(contacts, "address")),
      deps.email.getContactSamples(user.id, addresses, { maxPerContact: 3 }),
    ]);
    const sampleMap = new Map(contactSamples.map((s) => [s.address, s.subjects]));
    const enriched = withDefs.map((c) => ({
      ...c,
      examples: sampleMap.get(c.address) ?? [],
    }));
    return c.json({ contacts: enriched });
  });

  app.get("/messaging/dms", async (c) => {
    const user = c.get("user");
    if (!deps.messaging) return c.json({ conversations: [], message: "messaging not connected" });
    const dms = await deps.messaging.getDMs(user.id);
    const ids = dms.map((d) => d.id);
    const [withDefs, dmSamples] = await Promise.all([
      Promise.resolve(withDefaults(dms, "participantName")),
      deps.messaging.getDMSamples(user.id, ids, { maxPerConversation: 3 }),
    ]);
    const sampleMap = new Map(dmSamples.map((s) => [s.id, s.messages]));
    const enriched = withDefs.map((d) => ({
      ...d,
      examples: sampleMap.get(d.id) ?? [],
    }));
    return c.json({ conversations: enriched });
  });

  app.get("/calendar/visibility", async (c) => {
    const user = c.get("user");
    if (!deps.calendar) return c.json({ defaultVisibility: "public", calendars: [], message: "calendar not connected" });
    const vis = await deps.calendar.getVisibility(user.id);
    return c.json(vis);
  });

  app.post("/complete/:section", async (c) => {
    const user = c.get("user");
    const section = c.req.param("section");
    const body = await c.req.json();

    const current = await privacyConfigStore.get(user.id);
    const updated: PrivacyConfig = {
      version: 2,
      ...current,
      lastReviewedAt: Date.now(),
    };

    if (section === "email") {
      if (!validateEmail(body.email)) return c.json({ error: "invalid email config" }, 400);
      updated.email = body.email;
    } else if (section === "messaging") {
      if (!validateMessaging(body.messaging)) return c.json({ error: "invalid messaging config" }, 400);
      updated.messaging = body.messaging;
    } else if (section === "calendar") {
      if (!validateCalendar(body.calendar)) return c.json({ error: "invalid calendar config" }, 400);
      updated.calendar = body.calendar;
    } else {
      return c.json({ error: "unknown section" }, 400);
    }

    await privacyConfigStore.set(user.id, updated);
    logger.info({ userId: user.id, section }, "privacy section saved");
    return c.json({ ok: true });
  });

  app.post("/scan", async (c) => {
    const user = c.get("user");
    logger.info({ userId: user.id }, "privacy scan started");

    if (deps.mockMode && !deps.model) {
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({ event: "progress", data: JSON.stringify({ phase: "email-labels", pct: 30, message: "Analyzing email labels..." }) });
        await stream.writeSSE({ event: "progress", data: JSON.stringify({ phase: "email-contacts", pct: 60, message: "Analyzing contacts..." }) });
        await stream.writeSSE({ event: "progress", data: JSON.stringify({ phase: "messaging", pct: 85, message: "Analyzing conversations..." }) });
        const result = createMockScanResult();
        await stream.writeSSE({ event: "result", data: JSON.stringify(result) });
        await stream.writeSSE({ event: "progress", data: JSON.stringify({ phase: "done", pct: 100, message: "Scan complete" }) });
      });
    }

    if (!deps.model) {
      return c.json({ error: "scan unavailable — no LLM model configured" }, 503);
    }

    return streamSSE(c, async (stream) => {
      try {
        const result = await runPrivacyScan(user.id, {
          model: deps.model!,
          email: deps.email,
          messaging: deps.messaging,
          logger,
          onProgress: async (p) => {
            await stream.writeSSE({ event: "progress", data: JSON.stringify(p) });
          },
        });
        await stream.writeSSE({ event: "result", data: JSON.stringify(result) });
      } catch (err) {
        logger.error({ userId: user.id, err: (err as Error).message }, "privacy scan failed");
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: (err as Error).message }) });
      }
    });
  });

  return app;
}
