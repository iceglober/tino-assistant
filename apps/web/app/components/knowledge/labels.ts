import type { KbFactKind, KbScope } from "@tino/contracts";

export const KIND_ORDER: KbFactKind[] = [
  "project",
  "problem",
  "commitment",
  "decision",
  "person",
  "preference",
  "fact",
];

export const KIND_PLURAL: Record<KbFactKind, string> = {
  project: "projects",
  problem: "problems",
  commitment: "commitments",
  decision: "decisions",
  person: "people",
  preference: "preferences",
  fact: "facts",
};

export const SOURCE_LABEL: Record<string, string> = {
  slack_channel: "slack channel",
  slack_thread: "slack thread",
  slack_dm: "slack dm",
  gmail: "gmail",
  synthesis: "distilling",
  topics: "themes",
  slack: "slack",
};

export const sourceLabel = (s: string): string => SOURCE_LABEL[s] ?? s.replace(/_/g, " ");

export const readScope = (raw: string | null): KbScope => (raw === "workspace" ? "workspace" : "private");

export const SCOPE_BLURB: Record<KbScope, string> = {
  private: "your own DMs, private channels and email. only you can see this.",
  workspace: "public Slack channels — shared across everyone in the org who uses tino.",
};
