import type { HistoryStore } from "../agent/history.js";
import type { IdentityResolver } from "../identity/resolver.js";
import type { UserStore } from "../identity/store.js";
import type { AppLogger } from "./app.js";
import type { DmMessageEvent } from "./types.js";

export interface ResetHandlerParams {
  message: Partial<DmMessageEvent>;
  identityResolver: IdentityResolver;
  users: UserStore;
  history: HistoryStore;
  say: (args: { text: string }) => Promise<unknown>;
  logger: AppLogger;
}

/**
 * Handle the "reset" command. Returns true if the message was a reset command
 * (and was handled), false otherwise (caller should continue to the normal
 * agent handler).
 *
 * Guards: same DM + allowlist filter as handleDmMessage. Only matches
 * messages whose trimmed text is exactly "reset" (case-insensitive).
 *
 * Why not "/reset": Slack intercepts anything starting with "/" as a slash
 * command at the client level — the message never reaches Bolt. Using bare
 * "reset" avoids that entirely.
 */
export async function handleResetCommand(params: ResetHandlerParams): Promise<boolean> {
  const { message: m, identityResolver, users, history, say, logger } = params;

  if (m.subtype !== undefined) return false;
  if (m.channel_type !== "im") return false;
  if (!m.user) return false;

  const text = (m.text ?? "").trim().toLowerCase();
  if (text !== "reset") return false;

  const tinoUserId = await identityResolver.resolveSlack(m.user);
  if (!tinoUserId) return false;

  const user = await users.get(tinoUserId);
  if (!user || user.role !== "admin") return false;

  await history.reset(tinoUserId);
  logger.info({ user: m.user, tinoUserId }, "conversation history reset");
  await say({ text: "History cleared." });
  return true;
}
