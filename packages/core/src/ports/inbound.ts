/**
 * Inbound (driving) ports — the interfaces the application implements and the
 * driving adapters (Slack, HTTP) call. This is the app's public surface.
 */
import type { ResolveResult } from "../domain/types.js";

/** The assistant use-case: the one entrypoint both Slack and the web chat drive. */
export interface Assistant {
  /** Run one user message through the agent and return the reply text. */
  handleMessage(userId: string, text: string): Promise<string>;
  /** Clear a user's conversation history. Returns true if the user may reset (admin). */
  reset(userId: string): Promise<boolean>;
}

/** Resolves an inbound sender (by Slack id) to a tino user, or a rejection message. */
export interface SenderResolver {
  resolveSlack(slackUserId: string): Promise<ResolveResult>;
}

export type { ResolveResult };
