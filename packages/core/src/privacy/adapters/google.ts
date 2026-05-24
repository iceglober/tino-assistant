import { google } from "googleapis";
import type { AppLogger } from "../../slack/app.js";
import type { CalendarEvent, CalendarPort as DiscoveryCalendarPort } from "../../discovery/calendar-port.js";
import type { CalendarVisibility, PrivacyContact, PrivacyLabel } from "../types.js";
import type { CalendarPort, ContactSample, EmailPort, EmailSample } from "../ports.js";
import type { GoogleCreds } from "./credentials.js";

function makeOAuth2(creds: GoogleCreds) {
  const auth = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
  auth.setCredentials({ refresh_token: creds.refreshToken });
  return auth;
}

export function createGoogleEmailAdapter(deps: {
  resolveCreds: (userId: string) => Promise<GoogleCreds | null>;
  logger: AppLogger;
}): EmailPort {
  const { resolveCreds, logger } = deps;

  return {
    async getLabels(userId: string): Promise<PrivacyLabel[]> {
      const creds = await resolveCreds(userId);
      if (!creds) return [];

      try {
        const gmail = google.gmail({ version: "v1", auth: makeOAuth2(creds) });
        const res = await gmail.users.labels.list({ userId: "me" });
        const labels = res.data.labels ?? [];

        return labels
          .filter((l) => l.type === "user" && l.name)
          .map((l) => ({ name: l.name!, itemCount: l.messagesTotal ?? 0 }))
          .sort((a, b) => b.itemCount - a.itemCount);
      } catch (err) {
        logger.warn({ userId, err: (err as Error).message }, "privacy: failed to fetch email labels");
        return [];
      }
    },

    async getContacts(userId: string, opts?: { sinceDays?: number }): Promise<PrivacyContact[]> {
      const creds = await resolveCreds(userId);
      if (!creds) return [];

      const sinceDays = opts?.sinceDays ?? 180;
      const since = new Date();
      since.setDate(since.getDate() - sinceDays);
      const afterDate = `${since.getFullYear()}/${String(since.getMonth() + 1).padStart(2, "0")}/${String(since.getDate()).padStart(2, "0")}`;

      try {
        const gmail = google.gmail({ version: "v1", auth: makeOAuth2(creds) });
        const counts = new Map<string, { address: string; displayName?: string; count: number }>();

        let pageToken: string | undefined;
        do {
          const listRes = await gmail.users.messages.list({
            userId: "me",
            q: `after:${afterDate}`,
            maxResults: 100,
            pageToken,
          });
          const messageIds = (listRes.data.messages ?? []).map((m) => m.id!).filter(Boolean);

          const batchSize = 10;
          for (let i = 0; i < messageIds.length; i += batchSize) {
            const batch = messageIds.slice(i, i + batchSize);
            const results = await Promise.all(
              batch.map((id) =>
                gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "To"] }),
              ),
            );
            for (const r of results) {
              const headers = r.data.payload?.headers ?? [];
              for (const h of headers) {
                if (h.name !== "From" && h.name !== "To") continue;
                const match = h.value?.match(/<([^>]+)>/) ?? [null, h.value];
                const email = match[1]?.toLowerCase();
                if (!email) continue;
                const nameMatch = h.value?.match(/^([^<]+)</);
                const name = nameMatch?.[1]?.trim().replace(/^["']|["']$/g, "");
                const existing = counts.get(email);
                if (existing) {
                  existing.count++;
                } else {
                  counts.set(email, { address: email, displayName: name || undefined, count: 1 });
                }
              }
            }
          }

          pageToken = listRes.data.nextPageToken ?? undefined;
        } while (pageToken);

        return [...counts.values()]
          .sort((a, b) => b.count - a.count)
          .map((c) => ({ address: c.address, displayName: c.displayName, itemCount: c.count }));
      } catch (err) {
        logger.warn({ userId, err: (err as Error).message }, "privacy: failed to fetch email contacts");
        return [];
      }
    },

    async getSampleSubjects(userId: string, opts?: { maxPerLabel?: number }): Promise<EmailSample[]> {
      const creds = await resolveCreds(userId);
      if (!creds) return [];
      const maxPerLabel = opts?.maxPerLabel ?? 5;

      try {
        const gmail = google.gmail({ version: "v1", auth: makeOAuth2(creds) });
        const res = await gmail.users.labels.list({ userId: "me" });
        const userLabels = (res.data.labels ?? []).filter((l) => l.type === "user" && l.id && l.name);

        const samples: EmailSample[] = [];
        for (const label of userLabels) {
          const msgs = await gmail.users.messages.list({ userId: "me", labelIds: [label.id!], maxResults: maxPerLabel });
          const ids = (msgs.data.messages ?? []).map((m) => m.id!).filter(Boolean);
          const subjects: string[] = [];
          for (const id of ids) {
            const msg = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["Subject"] });
            const subj = msg.data.payload?.headers?.find((h) => h.name === "Subject")?.value;
            if (subj) subjects.push(subj);
          }
          samples.push({ label: label.name!, subjects });
        }
        return samples;
      } catch (err) {
        logger.warn({ userId, err: (err as Error).message }, "privacy: failed to fetch sample subjects");
        return [];
      }
    },

    async getContactSamples(userId: string, addresses: string[], opts?: { maxPerContact?: number }): Promise<ContactSample[]> {
      const creds = await resolveCreds(userId);
      if (!creds) return [];
      const maxPer = opts?.maxPerContact ?? 3;

      try {
        const gmail = google.gmail({ version: "v1", auth: makeOAuth2(creds) });
        const results: ContactSample[] = [];

        for (const addr of addresses.slice(0, 50)) {
          const msgs = await gmail.users.messages.list({ userId: "me", q: `from:${addr}`, maxResults: maxPer });
          const ids = (msgs.data.messages ?? []).map((m) => m.id!).filter(Boolean);
          const subjects: string[] = [];
          for (const id of ids) {
            const msg = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["Subject"] });
            const subj = msg.data.payload?.headers?.find((h) => h.name === "Subject")?.value;
            if (subj) subjects.push(subj);
          }
          results.push({ address: addr, subjects });
        }
        return results;
      } catch (err) {
        logger.warn({ userId, err: (err as Error).message }, "privacy: failed to fetch contact samples");
        return [];
      }
    },
  };
}

export function createGoogleCalendarAdapter(deps: {
  resolveCreds: (userId: string) => Promise<GoogleCreds | null>;
  logger: AppLogger;
}): CalendarPort & DiscoveryCalendarPort {
  const { resolveCreds, logger } = deps;

  return {
    async getVisibility(userId: string): Promise<CalendarVisibility> {
      const creds = await resolveCreds(userId);
      if (!creds) return { defaultVisibility: "public", calendars: [] };

      try {
        const cal = google.calendar({ version: "v3", auth: makeOAuth2(creds) });
        const res = await cal.calendarList.list();
        const items = res.data.items ?? [];

        return {
          defaultVisibility: "public",
          calendars: items.map((c) => ({
            id: c.id ?? "",
            name: c.summary ?? c.id ?? "",
          })),
        };
      } catch (err) {
        logger.warn({ userId, err: (err as Error).message }, "privacy: failed to fetch calendar visibility");
        return { defaultVisibility: "public", calendars: [] };
      }
    },

    async getEvents(userId: string, opts?: { sinceDays?: number }): Promise<CalendarEvent[]> {
      const creds = await resolveCreds(userId);
      if (!creds) return [];

      const sinceDays = opts?.sinceDays ?? 180;
      const timeMin = new Date();
      timeMin.setDate(timeMin.getDate() - sinceDays);

      try {
        const cal = google.calendar({ version: "v3", auth: makeOAuth2(creds) });
        const events: CalendarEvent[] = [];
        let pageToken: string | undefined;

        do {
          const res = await cal.events.list({
            calendarId: "primary",
            timeMin: timeMin.toISOString(),
            maxResults: 250,
            singleEvents: false,
            pageToken,
          });

          for (const item of res.data.items ?? []) {
            const startRaw = item.start?.dateTime ?? item.start?.date;
            if (!startRaw) continue;
            events.push({
              title: item.summary ?? "(no title)",
              attendees: (item.attendees ?? [])
                .map((a) => a.email ?? "")
                .filter(Boolean)
                .slice(0, 20),
              startTime: new Date(startRaw).getTime(),
              recurrence: item.recurrence?.[0],
            });
          }

          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);

        return events;
      } catch (err) {
        logger.warn({ userId, err: (err as Error).message }, "discovery: failed to fetch calendar events");
        return [];
      }
    },
  };
}
