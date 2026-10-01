/**
 * The Slack app an org creates in its own workspace. Generated per org so the
 * admin's only job is "Create from manifest", then paste three values back.
 *
 * Why the org owns the app rather than installing tino's: an app built inside
 * the customer's workspace is an "internal customer-built app" to Slack — it
 * keeps standard Web API rate limits. A commercially distributed app outside
 * the Slack Marketplace has conversations.history / .replies cut to 1 request
 * a minute (Slack, May 2025), which the knowledge base can't live with.
 *
 * Events arrive over HTTP at /slack/events/<orgId>, signed with the app's own
 * signing secret — no Socket Mode, so any number of orgs share one process
 * without one websocket each, and replicas become possible later.
 */

/** What the bot needs: read where it's mentioned, DM people, describe channels and people. */
export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "groups:read",
  "im:history",
  "im:read",
  "im:write",
  "mpim:read",
  "users:read",
  "users:read.email",
] as const;

/** What each person grants when they connect their own Slack: their DMs, private channels, and search. */
export const SLACK_USER_SCOPES = [
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "mpim:history",
  "mpim:read",
  "search:read",
] as const;

export interface SlackManifestInput {
  orgId: string;
  baseUrl: string;
  /** Shown in Slack; defaults to "Tino". */
  appName?: string;
}

export const slackEventsUrl = (baseUrl: string, orgId: string): string => `${baseUrl}/slack/events/${orgId}`;
export const slackRedirectUrl = (baseUrl: string): string => `${baseUrl}/api/oauth/slack/callback`;

export function buildSlackManifest({ orgId, baseUrl, appName = "Tino" }: SlackManifestInput) {
  return {
    display_information: {
      name: appName,
      description: "Your team's assistant — answers from your Slack, mail, and calendar.",
      background_color: "#141c27",
    },
    features: {
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      bot_user: { display_name: appName.toLowerCase(), always_online: true },
    },
    oauth_config: {
      redirect_urls: [slackRedirectUrl(baseUrl)],
      scopes: { bot: [...SLACK_BOT_SCOPES], user: [...SLACK_USER_SCOPES] },
    },
    settings: {
      event_subscriptions: {
        request_url: slackEventsUrl(baseUrl, orgId),
        bot_events: ["app_mention", "message.im"],
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}

/** Slack's "create an app from this manifest" link; the admin reviews it before anything is created. */
export function slackCreateAppUrl(manifest: ReturnType<typeof buildSlackManifest>): string {
  return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(manifest))}`;
}

/** Slack's OAuth v2 consent URL for an app. */
export function slackAuthorizeUrl(opts: {
  clientId: string;
  baseUrl: string;
  state: string;
  bot: boolean;
  teamId?: string | null;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    user_scope: SLACK_USER_SCOPES.join(","),
    redirect_uri: slackRedirectUrl(opts.baseUrl),
    state: opts.state,
  });
  if (opts.bot) params.set("scope", SLACK_BOT_SCOPES.join(","));
  if (opts.teamId) params.set("team", opts.teamId);
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}
