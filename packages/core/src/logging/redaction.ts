import type { AppLogger } from "../slack/app.js";

const PRIVATE_CAPABILITY_IDS = new Set(["gmail", "slack-personal", "calendar"]);

const PRIVATE_TOOL_NAMES = new Set([
  "calendar_list_events",
  "gmail_search",
  "gmail_get_message",
  "slack_list_dms",
  "slack_read_dm",
  "slack_read_thread",
]);

export function isPrivateCapabilityTool(toolName: string): boolean {
  return PRIVATE_TOOL_NAMES.has(toolName);
}

export function logToolResult(
  logger: AppLogger,
  ctx: { capabilityId?: string; toolName: string },
  result: unknown,
): void {
  if ((ctx.capabilityId && PRIVATE_CAPABILITY_IDS.has(ctx.capabilityId)) || isPrivateCapabilityTool(ctx.toolName)) {
    logger.info(
      { tool: ctx.toolName, capability: ctx.capabilityId, body: "<redacted: private capability>" },
      "tool result",
    );
    return;
  }
  logger.info({ tool: ctx.toolName, capability: ctx.capabilityId, body: result }, "tool result");
}
