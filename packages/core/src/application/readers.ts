/**
 * Works out who will read a reply. Direct conversations (a Slack DM, the web
 * chat) have one reader. A channel reply is read by the whole channel, unless
 * an admin chose the `asker` policy for mentions.
 *
 * When Slack can't tell us about a channel, we assume outsiders are present, so
 * only that channel's own messages may be used.
 */
import { CHANNEL_MENTION_POLICY_KEY } from "../domain/types.js";
import type { Readers } from "../domain/who-can-see.js";
import type { Surface } from "../ports/inbound.js";
import type { ChannelDirectory, ConfigStore, Logger } from "../ports/outbound.js";

export interface ReadersDeps {
  directory: ChannelDirectory | null;
  config: ConfigStore;
  logger: Logger;
}

export async function readersFor(
  surface: Surface,
  asker: { id: string; slackUserId: string | null },
  deps: ReadersDeps,
): Promise<Readers> {
  const askersChannels = async (): Promise<Set<string>> => {
    if (!asker.slackUserId || !deps.directory) return new Set();
    try {
      return new Set(await deps.directory.channelsOfSlackUser(asker.slackUserId));
    } catch (err) {
      deps.logger.warn({ err: (err as Error).message }, "couldn't list the asker's channels — recalling none");
      return new Set();
    }
  };

  if (surface.kind !== "channel") {
    return { soleReaderId: asker.id, includesOutsiders: false, channelsAllReadersAreIn: await askersChannels() };
  }

  const policy = await deps.config.getTyped<string>(CHANNEL_MENTION_POLICY_KEY, "workspace");
  if (policy === "asker") {
    const channels = await askersChannels();
    channels.add(surface.channelId); // they just posted there
    return { soleReaderId: asker.id, includesOutsiders: false, channelsAllReadersAreIn: channels };
  }

  const channel = deps.directory ? await deps.directory.describeChannel(surface.channelId).catch(() => null) : null;
  if (!channel)
    deps.logger.warn({ channel: surface.channelId }, "couldn't look up channel — treating it as shared with outsiders");
  return {
    soleReaderId: null,
    includesOutsiders: channel ? channel.includesOutsiders : true,
    channelsAllReadersAreIn: new Set([surface.channelId]),
  };
}
