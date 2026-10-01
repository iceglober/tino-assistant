/**
 * Inbound (driving) ports — the interfaces the application implements and the
 * driving adapters (Slack, HTTP) call. This is the app's public surface.
 */
import type { ResolveResult } from "../domain/types.js";

/**
 * Where a message was asked. A Slack DM and the web chat are read only by the
 * asker. A channel @mention is read by everyone in the channel.
 */
export type Surface =
  | { kind: "slack_dm" }
  | { kind: "web_chat" }
  | {
      kind: "channel";
      channelId: string;
      /** The thread's parent ts (the mention's own ts when it starts a thread). */
      threadTs: string;
      /** Recent channel/thread messages, so "this" has something to refer to. */
      recentChannelMessages?: string;
      /** Link back to the mention, for a follow-up in the asker's DM. */
      permalink?: string;
    };

/** The assistant use-case: the one entrypoint both Slack and the web chat drive. */
export interface Assistant {
  /** Run one user message through the agent and return the reply text. */
  handleMessage(userId: string, text: string, surface: Surface): Promise<string>;
  /** Clear the user's own DM + web chat conversation. False if the user doesn't exist. */
  reset(userId: string): Promise<boolean>;
}

/** Resolves an inbound sender (by Slack id) to a tino user, or a rejection message. */
export interface SenderResolver {
  resolveSlack(slackUserId: string): Promise<ResolveResult>;
}

export type { ResolveResult };
