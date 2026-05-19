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

    if (capId === "gmail" && body.gmail) {
      updated.gmail = body.gmail;
    } else if (capId === "slack" && body.slack) {
      updated.slack = body.slack;
    } else if (capId === "calendar" && body.calendar) {
      updated.calendar = body.calendar;
    } else {
      return c.json({ error: `unknown capability: ${capId}` }, 400);
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
