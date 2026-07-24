/**
 * Single source of capability display metadata (icon / name / short description).
 * The one source — do not re-declare per page.
 */
export interface CapMeta {
  icon: string;
  name: string;
  desc: string;
}

export const CAP_META: Record<string, CapMeta> = {
  github: { icon: "🐙", name: "GitHub", desc: "Repos, issues, and workflows" },
  calendar: { icon: "📅", name: "Calendar", desc: "Your Google Calendar" },
  gmail: { icon: "✉️", name: "Gmail", desc: "Read and draft email" },
  linear: { icon: "📐", name: "Linear", desc: "Issues and projects" },
  cloudwatch: { icon: "☁️", name: "CloudWatch", desc: "AWS logs and metrics" },
  slack: { icon: "💬", name: "Slack", desc: "Public channels" },
  "slack-personal": { icon: "🔒", name: "Slack (personal)", desc: "DMs and search as you" },
  mcp: { icon: "◆", name: "MCP Tools", desc: "Your own tool servers" },
};
