/**
 * Prompt injection defense — output validator.
 *
 * Runs after generateText returns, before posting to Slack or writing to Linear.
 * Checks for three categories of suspicious output:
 *
 * 1. Credential-like strings — tokens that look like real API keys/secrets.
 * 2. Response length anomaly — output >20,000 characters (MVP threshold).
 * 3. Cross-context references — output mentions capabilities the user hasn't
 *    enabled (e.g., email addresses when Gmail isn't active).
 *
 * Returns { safe: true } or { safe: false, reason: '...' }.
 */

export interface ValidationResult {
  safe: boolean;
  reason?: string;
}

export interface ValidationContext {
  userId: string;
  activeCapabilities: string[];
}

/**
 * Regex for credential-like strings.
 * Matches common token prefixes followed by non-whitespace characters.
 */
const CREDENTIAL_PATTERN = /xox[bpas]-\S+|ghp_\S+|github_pat_\S+|gho_\S+|lin_\S+|GOCSPX-\S+/;

/**
 * Maximum safe output length (MVP threshold).
 * Outputs longer than this are flagged as anomalous.
 */
const MAX_SAFE_LENGTH = 20_000;

/**
 * Cross-context signals: if a capability is NOT active but the output
 * contains one of its marker patterns, flag it.
 */
const CROSS_CONTEXT_SIGNALS: Record<string, RegExp> = {
  gmail: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b|\binbox\b|\bGmail\b/i,
  calendar: /\bGoogle Calendar\b|\bcalendar event\b|\bGCal\b/i,
  linear: /\bLIN-\d+\b|\bLinear issue\b/i,
  github: /\bghp_[A-Za-z0-9]+\b|\bgithub\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\b/i,
};

export function validateAgentOutput(output: string, context: ValidationContext): ValidationResult {
  // Check 1: credential-like strings
  const credMatch = CREDENTIAL_PATTERN.exec(output);
  if (credMatch) {
    return {
      safe: false,
      reason: `output contains a credential-like string matching pattern near: "${credMatch[0].slice(0, 20)}…"`,
    };
  }

  // Check 2: response length anomaly
  if (output.length > MAX_SAFE_LENGTH) {
    return {
      safe: false,
      reason: `output length ${output.length} exceeds maximum safe length of ${MAX_SAFE_LENGTH} characters`,
    };
  }

  // Check 3: cross-context references
  for (const [capability, pattern] of Object.entries(CROSS_CONTEXT_SIGNALS)) {
    if (!context.activeCapabilities.includes(capability) && pattern.test(output)) {
      return {
        safe: false,
        reason: `output references "${capability}" capability which is not active for this user`,
      };
    }
  }

  return { safe: true };
}
