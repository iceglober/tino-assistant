import { TOOL_TO_CAPABILITY } from "../privacy/filter.js";
import type { AppLogger } from "../slack/app.js";

const PRIVATE_CAPABILITY_IDS = new Set(["email", "messaging", "calendar"]);

export function isPrivateCapabilityTool(toolName: string): boolean {
  return toolName in TOOL_TO_CAPABILITY;
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
