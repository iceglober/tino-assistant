/**
 * The system prompt: a bare "you are tino" persona + a live clock (the model has
 * no clock of its own) + short usage notes for whatever tools are loaded. Pure.
 */
/** A message from one of this person's other conversations, cleared for these readers. */
export interface RecalledMessage {
  role: "user" | "tino";
  text: string;
  where: "slack_dm" | "web_chat" | "channel";
  channelId: string | null;
  at: number;
}

export function buildSystemPrompt(opts: {
  toolNames: string[];
  /** Who reads this reply. Defaults to only the asker. */
  readers?: { onlyTheAsker: boolean; includesOutsiders: boolean };
  /** Messages from the asker's other conversations that these readers may see. */
  recalled?: RecalledMessage[];
}): string {
  const tools = new Set(opts.toolNames);
  const now = new Date();

  const tzOffsetMin = now.getTimezoneOffset();
  const sign = tzOffsetMin <= 0 ? "+" : "-";
  const absMin = Math.abs(tzOffsetMin);
  const tzHH = String(Math.floor(absMin / 60)).padStart(2, "0");
  const tzMM = String(absMin % 60).padStart(2, "0");
  const pad = (n: number) => String(n).padStart(2, "0");
  const localIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${tzHH}:${tzMM}`;
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" });

  let prompt = `You are tino, a personal assistant for one user. You talk to them over Slack DM and in a web chat.

Current date and time: ${dateStr}, ${timeStr}
Current ISO-8601 timestamp: ${localIso}
Use this timestamp as your clock for any time-based tool call. Do NOT guess the current time.

Behavior:
- Be concise. Say so when you don't know; don't fabricate.
- Prefer specific, source-cited answers from tools over general knowledge when a tool can answer.
- Recency matters: every tool result carries timestamps — check them. For questions about the user's CURRENT state ("what am I working on", "problems I'm facing"), prefer recent evidence (date filters, timestamp sort) and say how old your evidence is.

Memory:
- The messages array you receive IS your conversation with this user — trust it.
- History is in-memory and ephemeral: if the process restarted, your context may be short. Don't claim "first message" unless the array truly has one user message.

Formatting:
- Reply in Slack mrkdwn: *bold*, _italic_, ~strike~, \`code\`, triple backticks for blocks. Do NOT use **double asterisks** or Markdown headers.

Tone:
- Lowercase, casual, warm but not performative. No "Great question!" — just answer. Keep it short.`;

  const hasGmail = tools.has("gmail_search") || tools.has("gmail_get_message");
  const hasCalendar = tools.has("calendar_list_events");
  const hasSlack = tools.has("slack_list_channels") || tools.has("slack_read_channel");
  const hasThisChannel = tools.has("slack_read_this_channel");
  const hasWorkspaceKnow = tools.has("kb_what_the_workspace_knows");
  const canContinueInDm = tools.has("continue_in_dm");
  const hasSlackUser = tools.has("slack_search_my_messages") || tools.has("slack_list_my_conversations");
  const hasKb = tools.has("kb_search_workspace") || tools.has("kb_search_mine");
  const hasKnow = tools.has("kb_what_you_know");

  const hasMcp = opts.toolNames.some((n) => n.startsWith("mcp_"));

  const readers = opts.readers ?? { onlyTheAsker: true, includesOutsiders: false };
  if (!readers.onlyTheAsker) {
    prompt += `\n\nWho reads this: this is a Slack channel thread. Everyone in the channel reads your replies, and several people may be talking to you in it.
- You only have sources everyone here may see. You do NOT have the asker's email, calendar, DMs, private channels, or private knowledge — say so plainly rather than guessing.`;
    if (readers.includesOutsiders) {
      prompt += `\n- People from outside the company are in this channel. Beyond this channel itself you have no internal sources, and must not reveal anything internal.`;
    }
    prompt += canContinueInDm
      ? `\n- If a good answer needs the asker's private context, answer what you can here, call \`continue_in_dm\`, and say you've sent the rest to their DMs.`
      : `\n- If a good answer needs the asker's private context, tell them to DM you the question.`;
  }

  const recalled = opts.recalled ?? [];
  if (recalled.length > 0) {
    const whereText = (m: RecalledMessage): string =>
      m.where === "channel" && m.channelId ? `<#${m.channelId}>` : m.where === "web_chat" ? "web chat" : "DM";
    const lines = recalled.map((m) => {
      const when = new Date(m.at).toISOString().slice(0, 16).replace("T", " ");
      const text = m.text.length > 400 ? `${m.text.slice(0, 400)}…` : m.text;
      return `[${when} · ${whereText(m)}] ${m.role === "user" ? "them" : "you"}: ${text.replace(/\s+/g, " ")}`;
    });
    prompt += `\n\nEarlier, elsewhere: recent messages from this person's other conversations with you (everyone reading this reply may see them). Use them for continuity when they're relevant; don't mention them otherwise.\n${lines.join("\n")}`;
  }

  if (
    hasGmail ||
    hasCalendar ||
    hasSlack ||
    hasThisChannel ||
    hasSlackUser ||
    hasKb ||
    hasKnow ||
    hasWorkspaceKnow ||
    hasMcp
  ) {
    prompt += `\n\nTools:`;
    if (hasWorkspaceKnow) {
      prompt += `\n- what you know about the workspace: \`kb_what_the_workspace_knows\` — durable facts distilled from public channels (projects, problems, decisions, people), with dates and permalinks. Start here for "what's the team working on", "what did we decide about X".`;
    }
    if (hasKnow) {
      prompt += `\n- what you know about this person: \`kb_what_you_know\` — durable facts distilled from this user's own history (projects, open problems, commitments, decisions, people, preferences), each with dated supporting excerpts. START HERE for "what am I working on", "what problems am I facing", "what do you know about me", "catch me up". Answer from these facts directly and cite their dates; drop to the search tools below only when you need the raw conversation or the facts don't cover the question.`;
    }
    if (hasKb) {
      prompt += `\n- knowledge base: \`kb_search_mine\` / \`kb_search_workspace\` — semantic + recency-ranked search over ~90 days of indexed Slack${tools.has("kb_search_mine") ? " and email" : ""}. PREFER these FIRST for open-ended or historical questions: "what problems am I facing", "what have I been working on", "catch me up on X", "what did we decide about Y". Then open the underlying thread/email (permalink → \`slack_read_my_thread\`; gmail id → \`gmail_get_message\`) before answering in depth. Use live search tools instead for right-now questions or exact keywords/people/dates.`;
    }
    if (hasGmail) {
      prompt += `\n- gmail: search with \`gmail_search\` (Gmail query syntax), then \`gmail_get_message\` for the full body of a specific result.`;
    }
    if (hasCalendar) {
      prompt += `\n- calendar: \`calendar_list_events\` for the user's schedule — pass an ISO time range using the timestamp above.`;
    }
    if (hasSlack) {
      prompt += `\n- public slack channels: \`slack_list_channels\`, \`slack_read_channel\`, \`slack_read_channel_thread\` — public channels only.`;
    }
    if (hasThisChannel) {
      prompt += `\n- this channel: \`slack_read_this_channel\` and \`slack_read_this_thread\` read further back in the channel you were asked in.`;
    }
    if (hasMcp) {
      prompt += `\n- connected systems: tools named \`mcp_<server>_<tool>\` come from MCP servers the workspace or this user connected (issue trackers, CRMs, internal APIs, …). Use them when the question is about that system; their own descriptions say what they do. Some can change data — confirm with the user before any create/update/delete.`;
    }
    if (hasSlackUser) {
      prompt += `\n- slack (this user's own messages): \`slack_search_my_messages\` to search their DMs + channels — each hit has a \`channelId\` and \`ts\`. Its default ranking has NO recency weighting: for recent/current-state questions pass \`sort: "timestamp"\` and/or \`after\`. To get the full discussion behind a hit, call \`slack_read_my_thread\` with that channelId + ts (works in private DMs); use \`slack_read_my_conversation\` (supports \`oldest\`/\`latest\`) for recent messages and \`slack_list_my_conversations\` to find an id. Don't stop at search snippets when the user asks what a discussion was about — read the thread. These use the user's own token, so only THIS user's private messages, and only when they've connected Slack. If a slack tool returns an auth error, tell them to DM you "connect".`;
    }
  }

  return prompt;
}
