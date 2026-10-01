/**
 * Slack's Events API, over HTTP:
 *
 *   POST /slack/events/:orgId   → an org's own Slack app (signed with its signing secret)
 *   POST /slack/events          → tino's managed app, if offered (routed by team id)
 *
 * Verify the signature, answer `url_verification`, ack within Slack's 3 s, then
 * hand the event to the org's Bolt app in the background. Retries Slack sends
 * after a slow ack are dropped: the first delivery is already being handled.
 */

import type { Logger, OrgStore } from "@tino/core/ports/outbound";
import { Hono } from "hono";
import type { OrgRuntime } from "../../../../bootstrap/org-runtime.js";
import { parseSlackBody, verifySlackSignature } from "../../slack/verify.js";

export function createSlackEventRoutes(deps: {
  runtime: (orgId: string) => Promise<OrgRuntime | null>;
  orgs: OrgStore;
  /** The managed app's signing secret, when tino offers one. */
  platformSigningSecret?: string;
  logger: Logger;
}): Hono {
  const app = new Hono();
  const { logger } = deps;

  async function handle(
    raw: string,
    headers: Headers,
    body: Record<string, unknown>,
    rt: OrgRuntime,
    signingSecret: string,
  ): Promise<Response> {
    const ok = verifySlackSignature({
      signingSecret,
      rawBody: raw,
      timestamp: headers.get("x-slack-request-timestamp") ?? undefined,
      signature: headers.get("x-slack-signature") ?? undefined,
    });
    if (!ok) return new Response("invalid signature", { status: 401 });
    if (body.type === "url_verification") return Response.json({ challenge: body.challenge });

    const teamId = teamOf(body);
    if (rt.org.slackTeamId && teamId && teamId !== rt.org.slackTeamId) {
      logger.warn({ org: rt.org.slug, teamId }, "slack event from a workspace this org didn't install into");
      return new Response("wrong team", { status: 403 });
    }
    if (headers.get("x-slack-retry-num")) return new Response("", { status: 200 });

    const bolt = rt.slackApp();
    if (bolt) {
      void bolt
        .processEvent({ body, ack: async () => {} })
        .catch((err: Error) => logger.error({ org: rt.org.slug, err: err.message }, "slack event handler failed"));
    }
    return new Response("", { status: 200 });
  }

  app.post("/events/:orgId", async (c) => {
    const raw = await c.req.text();
    const body = parseSlackBody(raw, c.req.header("content-type"));
    if (!body) return c.text("bad request", 400);
    const rt = await deps.runtime(c.req.param("orgId"));
    if (!rt) return c.text("unknown org", 404);
    const secret = await rt.stores.config.getTyped<string>("slack.signingSecret", "");
    if (!secret) {
      // Slack checks the URL the moment the app is created from the manifest, before
      // the admin has pasted the signing secret back. Echoing a challenge reveals nothing.
      return body.type === "url_verification" ? c.json({ challenge: body.challenge }) : c.text("not configured", 409);
    }
    return handle(raw, c.req.raw.headers, body, rt, secret);
  });

  app.post("/events", async (c) => {
    if (!deps.platformSigningSecret) return c.text("not found", 404);
    const raw = await c.req.text();
    const body = parseSlackBody(raw, c.req.header("content-type"));
    if (!body) return c.text("bad request", 400);
    if (body.type === "url_verification") {
      const ok = verifySlackSignature({
        signingSecret: deps.platformSigningSecret,
        rawBody: raw,
        timestamp: c.req.header("x-slack-request-timestamp"),
        signature: c.req.header("x-slack-signature"),
      });
      return ok ? c.json({ challenge: body.challenge }) : c.text("invalid signature", 401);
    }
    const teamId = teamOf(body);
    const org = teamId ? await deps.orgs.getBySlackTeam(teamId) : null;
    const rt = org ? await deps.runtime(org.id) : null;
    if (!rt) return c.text("", 200); // an install we don't know (yet); nothing to do
    return handle(raw, c.req.raw.headers, body, rt, deps.platformSigningSecret);
  });

  return app;
}

function teamOf(body: Record<string, unknown>): string | null {
  if (typeof body.team_id === "string") return body.team_id;
  const team = body.team as { id?: unknown } | undefined;
  if (team && typeof team.id === "string") return team.id;
  const auths = body.authorizations as Array<{ team_id?: unknown }> | undefined;
  return typeof auths?.[0]?.team_id === "string" ? auths[0].team_id : null;
}
