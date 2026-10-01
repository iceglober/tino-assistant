/**
 * Transactional email: verification links and invitations. Resend's HTTP API
 * when RESEND_API_KEY is set; otherwise the message is logged, which is what
 * local dev wants and lets a fresh deployment work before email is set up.
 */
import type { Logger } from "@tino/core/ports/outbound";

export interface Email {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(email: Email): Promise<void>;
  /** False when messages are only logged. */
  readonly delivers: boolean;
}

export function createEmailSender(opts: { resendApiKey?: string; from: string; logger: Logger }): EmailSender {
  const { resendApiKey, from, logger } = opts;
  if (!resendApiKey) {
    return {
      delivers: false,
      async send(email) {
        // The text holds the link the person needs; in dev, that's the point of logging it.
        logger.info({ to: email.to, subject: email.subject, link: email.text }, "email (not sent — RESEND_API_KEY unset)");
      },
    };
  }
  return {
    delivers: true,
    async send(email) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`email send failed: ${res.status} ${detail.slice(0, 200)}`);
      }
    },
  };
}
