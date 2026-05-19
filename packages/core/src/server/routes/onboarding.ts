import { Hono } from "hono";
import type { PrivacyConfigStore } from "../../privacy/config-store.js";
import type { PrivacyConfig } from "../../privacy/types.js";
import type { AppLogger } from "../../slack/app.js";
import type { AuthVariables } from "../middleware/auth.js";

export const PRIVACY_REGEX = /private|personal|hr|legal|medical|doctor|therapy|family|finance|tax/i;

export interface OnboardingDeps {
  privacyConfigStore: PrivacyConfigStore;
  logger: AppLogger;
  getGmailLabels?: (userId: string) => Promise<Array<{ name: string; messageCount: number }>>;
  getGmailContacts?: (userId: string) => Promise<Array<{ email: string; name?: string; messageCount: number }>>;
  getSlackDms?: (userId: string) => Promise<Array<{ channelId: string; userId?: string; userName?: string; messageCount: number }>>;
  getCalendarVisibility?: (userId: string) => Promise<{ defaultVisibility: string; calendars: Array<{ id: string; summary: string; defaultVisibility: string }> }>;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function validateGmail(v: unknown): v is { privateLabels: string[]; denyListedAddresses: string[]; threadingMode: "conservative" } {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return isStringArray(o.privateLabels) && isStringArray(o.denyListedAddresses) && o.threadingMode === "conservative";
}

function validateSlack(v: unknown): v is { denyListedConversationIds: string[]; denyListedUserIds: string[]; multiPartyMode: "conservative" } {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return isStringArray(o.denyListedConversationIds) && isStringArray(o.denyListedUserIds) && o.multiPartyMode === "conservative";
}

const VALID_VISIBILITIES = new Set(["default", "public", "private", "confidential"]);

function validateCalendar(v: unknown): v is { defaultVisibility: string; gateAllByDefault: boolean } {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.defaultVisibility === "string" && VALID_VISIBILITIES.has(o.defaultVisibility) && typeof o.gateAllByDefault === "boolean";
}

export function createOnboardingRoutes(deps: OnboardingDeps): Hono<{ Variables: AuthVariables }> {
  const { privacyConfigStore, logger } = deps;
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/gmail/labels", async (c) => {
    const user = c.get("user");
    if (!deps.getGmailLabels) return c.json({ labels: [], message: "gmail not connected" });
    const labels = await deps.getGmailLabels(user.id);
    return c.json({
      labels: labels.slice(0, 15).map((l) => ({
        ...l,
        preChecked: PRIVACY_REGEX.test(l.name),
      })),
    });
  });

  app.get("/gmail/contacts", async (c) => {
    const user = c.get("user");
    if (!deps.getGmailContacts) return c.json({ contacts: [], message: "gmail not connected" });
    const contacts = await deps.getGmailContacts(user.id);
    return c.json({
      contacts: contacts.slice(0, 15).map((ct) => ({
        ...ct,
        preChecked: PRIVACY_REGEX.test(ct.email.split("@")[0] ?? ""),
      })),
    });
  });

  app.get("/slack/dms", async (c) => {
    const user = c.get("user");
    if (!deps.getSlackDms) return c.json({ conversations: [], message: "slack not connected" });
    const dms = await deps.getSlackDms(user.id);
    return c.json({
      conversations: dms.slice(0, 15).map((dm) => ({
        ...dm,
        preChecked: PRIVACY_REGEX.test(dm.userName ?? ""),
      })),
    });
  });

  app.get("/calendar/visibility", async (c) => {
    const user = c.get("user");
    if (!deps.getCalendarVisibility) return c.json({ defaultVisibility: "public", calendars: [], message: "calendar not connected" });
    const vis = await deps.getCalendarVisibility(user.id);
    return c.json(vis);
  });

  app.post("/complete/:capabilityId", async (c) => {
    const user = c.get("user");
    const capId = c.req.param("capabilityId");
    const body = await c.req.json();

    const current = await privacyConfigStore.get(user.id);
    const updated: PrivacyConfig = {
      version: 1,
      ...current,
      lastReviewedAt: Date.now(),
      lastRepromptAt: current?.lastRepromptAt ?? null,
    };

    if (capId === "gmail") {
      if (!validateGmail(body.gmail)) return c.json({ error: "invalid gmail config" }, 400);
      updated.gmail = body.gmail;
    } else if (capId === "slack") {
      if (!validateSlack(body.slack)) return c.json({ error: "invalid slack config" }, 400);
      updated.slack = body.slack;
    } else if (capId === "calendar") {
      if (!validateCalendar(body.calendar)) return c.json({ error: "invalid calendar config" }, 400);
      updated.calendar = body.calendar;
    } else {
      return c.json({ error: "unknown capability" }, 400);
    }

    await privacyConfigStore.set(user.id, updated);
    logger.info({ userId: user.id, capability: capId }, "onboarding step completed");
    return c.json({ ok: true });
  });

  app.post("/finalize", async (c) => {
    const user = c.get("user");
    logger.info({ userId: user.id }, "privacy onboarding finalized");
    return c.json({ ok: true, completedAt: Date.now() });
  });

  return app;
}
