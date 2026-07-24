/**
 * Single source of capability display metadata (icon / name / description).
 * Previously copy-pasted across Capabilities.tsx, CapabilityCard.tsx, and
 * CapabilityModal.tsx — consolidated here so they can't drift.
 */
export interface CapMeta {
  icon: string;
  name: string;
  desc: string;
}

export const CAP_META: Record<string, CapMeta> = {
  github: { icon: "🐙", name: "GitHub", desc: "Repos, issues, pull requests, and workflow dispatch." },
  calendar: { icon: "📅", name: "Calendar", desc: "Read your Google Calendar so tino knows your schedule." },
  gmail: { icon: "✉️", name: "Gmail", desc: "Search, read, and draft email on your behalf." },
  linear: { icon: "📐", name: "Linear", desc: "Issues and projects — triage, update, comment." },
  cloudwatch: { icon: "☁️", name: "CloudWatch", desc: "AWS logs and metrics." },
  slack: { icon: "💬", name: "Slack", desc: "Public channels and content." },
  "slack-personal": { icon: "🔒", name: "Slack (personal)", desc: "DMs, search, and private messages as you." },
};
