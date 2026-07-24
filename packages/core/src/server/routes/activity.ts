import { Hono } from "hono";
import type { AuditLogger } from "../../audit/logger.js";
import type { AppLogger } from "../../slack/app.js";
import type { AuthVariables } from "../middleware/auth.js";

export interface ActivityRoutesOpts {
  auditLogger: AuditLogger;
  logger: AppLogger;
}

const CAP_NAMES: Record<string, string> = {
  gmail: "Gmail",
  calendar: "Calendar",
  github: "GitHub",
  linear: "Linear",
  slack: "Slack",
  "slack-personal": "Slack (personal)",
  cloudwatch: "CloudWatch",
  mcp: "MCP Tools",
};

const ACTION_LABELS: Record<string, (entry: { toolName?: string; metadata?: Record<string, unknown> }) => string> = {
  tool_call: (e) => (e.toolName ? `Used ${e.toolName}` : "Tool call"),
  config_change: (e) => {
    const key = e.metadata?.key;
    return key ? `Updated ${key}` : "Updated configuration";
  },
  login: () => "Signed in",
  capability_toggle: (e) => {
    const raw = String(e.metadata?.capabilityId ?? "capability");
    const cap = CAP_NAMES[raw] ?? raw;
    return e.metadata?.enabled ? `Enabled ${cap}` : `Disabled ${cap}`;
  },
  task_scheduled: (e) => {
    const desc = e.metadata?.description;
    return desc ? `Scheduled: ${desc}` : "Scheduled a task";
  },
  task_executed: (e) => {
    const desc = e.metadata?.description;
    return desc ? `Ran: ${desc}` : "Ran a task";
  },
  slack_message_sent: (e) => (e.metadata?.channel ? "Replied in a Slack channel" : "Sent you a Slack message"),
  privacy_config_change: () => "Updated privacy settings",
  privacy_setup_completed: () => "Completed privacy setup",
  role_change: (e) => {
    const target = e.metadata?.targetEmail ?? e.metadata?.targetUserId;
    const role = e.metadata?.role;
    return target ? `Changed ${target} to ${role}` : "Changed user role";
  },
};

export function createActivityRoutes(opts: ActivityRoutesOpts): Hono<{ Variables: AuthVariables }> {
  const { auditLogger } = opts;
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/recent", async (c) => {
    const user = c.get("user");
    const limitStr = c.req.query("limit");
    const limit = limitStr ? Math.min(Number(limitStr), 100) : 50;

    const entries = await auditLogger.query({
      userId: user.id,
      limit,
    });

    const items = entries.map((e, i) => {
      const labeler = ACTION_LABELS[e.action];
      const summary = labeler ? labeler(e) : e.action.replace(/_/g, " ");
      const taskId = e.metadata?.taskId;
      return {
        id: `${e.timestamp}-${i}`,
        type: e.action,
        summary,
        status: e.status,
        timestamp: e.timestamp,
        ...(typeof taskId === "string" ? { taskId } : {}),
      };
    });

    return c.json({ items });
  });

  return app;
}
