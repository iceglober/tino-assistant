import type { AppLogger } from "../slack/app.js";
import type { IdentityStore, UserStore } from "./store.js";

export interface SlackWebClient {
  users: {
    info(args: { user: string }): Promise<{
      user?: { profile?: { email?: string } };
    }>;
  };
}

export interface IdentityResolver {
  resolveSlack(slackUserId: string): Promise<string | null>;
  resolveGoogle(email: string): Promise<string | null>;
}

export interface IdentityResolverOpts {
  users: UserStore;
  identities: IdentityStore;
  slackClient: SlackWebClient;
  logger: AppLogger;
}

export function createIdentityResolver(opts: IdentityResolverOpts): IdentityResolver {
  const { identities } = opts;

  return {
    resolveSlack(slackUserId: string): Promise<string | null> {
      return identities.resolve("slack", slackUserId);
    },

    resolveGoogle(email: string): Promise<string | null> {
      return identities.resolve("google", email.toLowerCase());
    },
  };
}
