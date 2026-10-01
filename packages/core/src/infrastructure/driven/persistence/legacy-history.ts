/**
 * Turns one row of the old per-user history table (`user_id → messages[]`)
 * into conversation-log messages. Keys were either a tino user id (their DM +
 * web chat) or, briefly, `channel:<id>:<threadTs>` for channel threads.
 */
import { channelThreadKey, directThreadKey } from "../../../domain/types.js";
import { describeWhoCanSee, membersOfChannel, onlyUser } from "../../../domain/who-can-see.js";
import { describeModelMessage } from "../model/describe-message.js";

export interface ImportedRow {
  threadKey: string;
  turnId: string;
  askedBy: string;
  askedWhere: string;
  whoCanSee: string;
  role: string;
  text: string | null;
  messageJson: string;
  createdAt: number;
}

export function importLegacyHistory(key: string, messagesJson: string, updatedAt: number): ImportedRow[] {
  let messages: unknown[];
  try {
    messages = JSON.parse(messagesJson) as unknown[];
  } catch {
    return [];
  }
  const channel = key.match(/^channel:([^:]+):(.+)$/);
  const base = channel
    ? {
        threadKey: channelThreadKey(channel[1] as string, channel[2] as string),
        askedBy: "",
        askedWhere: "channel",
        whoCanSee: describeWhoCanSee(membersOfChannel(channel[1] as string)),
      }
    : {
        threadKey: directThreadKey(key),
        askedBy: key,
        askedWhere: "slack_dm",
        whoCanSee: describeWhoCanSee(onlyUser(key)),
      };
  const turnId = `imported:${key}`;
  return messages.map((m, i) => {
    const { role } = describeModelMessage(m);
    // Imported messages keep the thread going but aren't recalled elsewhere:
    // we can't tell which of them used private sources.
    return {
      ...base,
      turnId,
      role,
      text: null,
      messageJson: JSON.stringify(m),
      createdAt: updatedAt - (messages.length - i),
    };
  });
}
