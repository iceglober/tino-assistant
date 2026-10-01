/**
 * Who may see what. Every piece of context tino can use — a tool's results, a
 * past message — says who is allowed to see it. Every reply knows who will
 * read it. A reply may only use context that every one of its readers is
 * allowed to see. That single rule is what keeps a DM's contents out of a
 * channel, and it is also what lets a DM remember a channel thread.
 *
 * Pure: no I/O. The Slack lookups that fill in `Readers` live in adapters.
 */

/** Who is allowed to see a piece of data. */
export type WhoCanSee =
  | { kind: "everyoneInWorkspace" }
  /** `insidersOnly`: members of the channel who are also in the company — no Slack Connect guests. */
  | { kind: "membersOfChannel"; channelId: string; insidersOnly?: boolean }
  | { kind: "onlyUser"; userId: string }
  /** Only this person, and only while they're in this channel — their private sources used in a channel. */
  | { kind: "onlyUserInChannel"; userId: string; channelId: string }
  /** Unknown, or a mix nobody may see in full. Never shown to anyone. */
  | { kind: "nobody" };

/** The people who will read the reply tino is about to write. */
export interface Readers {
  /** Set when exactly one person reads the reply: a DM or the web chat. */
  soleReaderId: string | null;
  /** Someone from outside the company reads it: a Slack Connect channel, a guest. */
  includesOutsiders: boolean;
  /** Channels that every reader is a member of. */
  channelsAllReadersAreIn: ReadonlySet<string>;
}

export const everyoneInWorkspace: WhoCanSee = { kind: "everyoneInWorkspace" };
export const nobody: WhoCanSee = { kind: "nobody" };
export const onlyUser = (userId: string): WhoCanSee => ({ kind: "onlyUser", userId });
export const membersOfChannel = (channelId: string, opts: { insidersOnly?: boolean } = {}): WhoCanSee =>
  opts.insidersOnly
    ? { kind: "membersOfChannel", channelId, insidersOnly: true }
    : { kind: "membersOfChannel", channelId };
export const onlyUserInChannel = (userId: string, channelId: string): WhoCanSee => ({
  kind: "onlyUserInChannel",
  userId,
  channelId,
});

/** True when every reader is allowed to see the data. */
export function readersMaySee(readers: Readers, data: WhoCanSee): boolean {
  switch (data.kind) {
    case "everyoneInWorkspace":
      return !readers.includesOutsiders;
    case "membersOfChannel":
      // Outsiders in a shared channel may see that channel, but only that one,
      // and not anything that also drew on internal sources.
      return readers.channelsAllReadersAreIn.has(data.channelId) && !(data.insidersOnly && readers.includesOutsiders);
    case "onlyUser":
      return readers.soleReaderId === data.userId;
    case "onlyUserInChannel":
      return readers.soleReaderId === data.userId && readers.channelsAllReadersAreIn.has(data.channelId);
    case "nobody":
      return false;
  }
}

/**
 * Who may see something built from both `a` and `b`: only people allowed to
 * see both. Two different channels or two different people can't be narrowed
 * to one audience we can name, so the result is `nobody`.
 */
export function strictestOf(a: WhoCanSee, b: WhoCanSee): WhoCanSee {
  if (a.kind === "nobody" || b.kind === "nobody") return nobody;

  // Otherwise each side names at most one person and at most one channel.
  // Both sides' conditions must hold, so the people must agree and so must the channels.
  const personOf = (w: WhoCanSee) => (w.kind === "onlyUser" || w.kind === "onlyUserInChannel" ? w.userId : null);
  const channelOf = (w: WhoCanSee) =>
    w.kind === "membersOfChannel" || w.kind === "onlyUserInChannel" ? w.channelId : null;
  const [pa, pb, ca, cb] = [personOf(a), personOf(b), channelOf(a), channelOf(b)];
  if (pa && pb && pa !== pb) return nobody;
  if (ca && cb && ca !== cb) return nobody;
  const person = pa ?? pb;
  const channel = ca ?? cb;
  // Anything that drew on workspace-only sources stays away from outsiders.
  const insidersOnly = [a, b].some(
    (w) => w.kind === "everyoneInWorkspace" || (w.kind === "membersOfChannel" && w.insidersOnly === true),
  );
  if (person && channel) return onlyUserInChannel(person, channel); // a sole reader is never an outsider
  if (person) return onlyUser(person);
  if (channel) return membersOfChannel(channel, { insidersOnly });
  return everyoneInWorkspace;
}

/** Stable text form, for storage. */
export function describeWhoCanSee(w: WhoCanSee): string {
  switch (w.kind) {
    case "everyoneInWorkspace":
      return "workspace";
    case "membersOfChannel":
      return w.insidersOnly ? `channel:${w.channelId}:insiders` : `channel:${w.channelId}`;
    case "onlyUser":
      return `user:${w.userId}`;
    case "onlyUserInChannel":
      return `user:${w.userId}@channel:${w.channelId}`;
    case "nobody":
      return "nobody";
  }
}

/** Inverse of describeWhoCanSee. Anything unrecognized becomes `nobody`. */
export function parseWhoCanSee(s: string): WhoCanSee {
  if (s === "workspace") return everyoneInWorkspace;
  const channel = s.match(/^channel:([^:@]+)(:insiders)?$/);
  if (channel) return membersOfChannel(channel[1] as string, { insidersOnly: !!channel[2] });
  const inChannel = s.match(/^user:([^@]+)@channel:(.+)$/);
  if (inChannel) return onlyUserInChannel(inChannel[1] as string, inChannel[2] as string);
  if (s.startsWith("user:") && s.length > 5 && !s.includes("@")) return onlyUser(s.slice(5));
  return nobody;
}
