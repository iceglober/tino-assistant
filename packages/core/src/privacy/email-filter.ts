import { createHash } from "node:crypto";
import type { Decision, EmailPrivacyConfig } from "./types.js";

interface EmailMessage {
  id?: string;
  threadId?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  labels?: string[];
  subject?: string;
  internalDate?: string;
}

interface EmailToolResult {
  messages?: EmailMessage[];
  id?: string;
  threadId?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  labels?: string[];
  subject?: string;
  body?: string;
  internalDate?: string;
  error?: string;
}

function normalizeAddress(addr: string): string {
  const match = addr.match(/<([^>]+)>/);
  const raw = match ? match[1]! : addr;
  const lower = raw.trim().toLowerCase();
  const atIdx = lower.indexOf("@");
  if (atIdx === -1) return lower;
  let local = lower.slice(0, atIdx);
  const domain = lower.slice(atIdx + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
  }
  const plusIdx = local.indexOf("+");
  if (plusIdx !== -1) local = local.slice(0, plusIdx);
  return `${local}@${domain}`;
}

function extractAddresses(field: string | undefined): string[] {
  if (!field) return [];
  return field.split(",").map((a) => normalizeAddress(a));
}

function hashLabel(label: string): string {
  return createHash("sha256").update(label).digest("hex").slice(0, 12);
}

function checkMessage(
  msg: { from?: string; to?: string; cc?: string; bcc?: string; labels?: string[] },
  config: EmailPrivacyConfig,
): { gated: true; reason: "private_folder" | "address_deny_listed"; labelHash?: string } | { gated: false } {
  if (msg.labels) {
    const lower = new Set(config.privateFolders.map((l) => l.toLowerCase()));
    for (const label of msg.labels) {
      if (lower.has(label.toLowerCase())) {
        return { gated: true, reason: "private_folder", labelHash: hashLabel(label) };
      }
    }
  }

  const normalizedDeny = new Set(config.denyListedAddresses.map((a) => normalizeAddress(a)));
  const allAddresses = [
    ...extractAddresses(msg.from),
    ...extractAddresses(msg.to),
    ...extractAddresses(msg.cc),
    ...extractAddresses(msg.bcc),
  ];
  for (const addr of allAddresses) {
    if (normalizedDeny.has(addr)) {
      return { gated: true, reason: "address_deny_listed" };
    }
  }

  return { gated: false };
}

export function emailFilter(
  _toolArgs: unknown,
  toolResult: unknown,
  config: EmailPrivacyConfig | undefined,
): Decision {
  const result = toolResult as EmailToolResult;
  if (result.error) return { persist: true };
  if (!config) return { persist: true };

  if (result.body !== undefined || result.id) {
    const check = checkMessage(result, config);
    if (check.gated) {
      return {
        persist: false,
        placeholder: {
          type: "redacted",
          reason: check.reason,
          metadata: {
            threadId: result.threadId,
            receivedAt: result.internalDate,
            ...(check.labelHash ? { labelHash: check.labelHash } : {}),
          },
        },
      };
    }
    return { persist: true };
  }

  if (result.messages) {
    for (const msg of result.messages) {
      const check = checkMessage(msg, config);
      if (check.gated) {
        return {
          persist: false,
          placeholder: {
            type: "redacted",
            reason: check.reason,
            metadata: {
              threadId: msg.threadId,
              receivedAt: msg.internalDate,
              ...(check.labelHash ? { labelHash: check.labelHash } : {}),
            },
          },
        };
      }
    }
  }

  return { persist: true };
}
