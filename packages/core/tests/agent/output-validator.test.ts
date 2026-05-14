import { describe, it, expect } from 'vitest';
import { validateAgentOutput } from '../../src/agent/output-validator.js';

describe('validateAgentOutput', () => {
  // ── Check 1: credential-like strings ──────────────────────────────────────

  it('flags Slack bot token (xoxb-)', () => {
    const result = validateAgentOutput(
      'Here is your token: xoxb-123456789-abcdefghij',
      { userId: 'U1', activeCapabilities: [] },
    );
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/credential/i);
  });

  it('flags Slack user token (xoxp-)', () => {
    const result = validateAgentOutput(
      'xoxp-987654321-zyxwvutsrqp is the token',
      { userId: 'U1', activeCapabilities: [] },
    );
    expect(result.safe).toBe(false);
  });

  it('flags GitHub PAT (ghp_)', () => {
    const result = validateAgentOutput(
      'Use ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef to authenticate',
      { userId: 'U1', activeCapabilities: [] },
    );
    expect(result.safe).toBe(false);
  });

  it('flags GitHub fine-grained PAT (github_pat_)', () => {
    const result = validateAgentOutput(
      'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz',
      { userId: 'U1', activeCapabilities: [] },
    );
    expect(result.safe).toBe(false);
  });

  it('flags Linear token (lin_)', () => {
    const result = validateAgentOutput(
      'lin_api_abcdefghijklmnopqrstuvwxyz123456',
      { userId: 'U1', activeCapabilities: [] },
    );
    expect(result.safe).toBe(false);
  });

  it('flags Google OAuth client secret (GOCSPX-)', () => {
    const result = validateAgentOutput(
      'GOCSPX-abcdefghijklmnopqrstuvwxyz',
      { userId: 'U1', activeCapabilities: [] },
    );
    expect(result.safe).toBe(false);
  });

  it('passes clean output with no credentials', () => {
    const result = validateAgentOutput(
      'Here is a summary of your GitHub issues. You have 3 open PRs.',
      { userId: 'U1', activeCapabilities: ['github'] },
    );
    expect(result.safe).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  // ── Check 2: response length anomaly ──────────────────────────────────────

  it('flags output longer than 20,000 characters', () => {
    const longOutput = 'a'.repeat(20_001);
    const result = validateAgentOutput(
      longOutput,
      { userId: 'U1', activeCapabilities: [] },
    );
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/length/i);
  });

  it('passes output exactly at 20,000 characters', () => {
    const borderOutput = 'a'.repeat(20_000);
    const result = validateAgentOutput(
      borderOutput,
      { userId: 'U1', activeCapabilities: [] },
    );
    expect(result.safe).toBe(true);
  });

  it('passes normal-length output', () => {
    const result = validateAgentOutput(
      'Short response.',
      { userId: 'U1', activeCapabilities: [] },
    );
    expect(result.safe).toBe(true);
  });

  // ── Check 3: cross-context references ─────────────────────────────────────

  it('flags email address when gmail is not active', () => {
    const result = validateAgentOutput(
      'You have a message from alice@example.com in your inbox.',
      { userId: 'U1', activeCapabilities: [] },
    );
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/gmail/i);
  });

  it('passes email address when gmail is active', () => {
    const result = validateAgentOutput(
      'You have a message from alice@example.com in your inbox.',
      { userId: 'U1', activeCapabilities: ['gmail'] },
    );
    expect(result.safe).toBe(true);
  });

  it('flags "inbox" mention when gmail is not active', () => {
    const result = validateAgentOutput(
      'Check your inbox for the confirmation.',
      { userId: 'U1', activeCapabilities: [] },
    );
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/gmail/i);
  });

  it('passes "inbox" mention when gmail is active', () => {
    const result = validateAgentOutput(
      'Check your inbox for the confirmation.',
      { userId: 'U1', activeCapabilities: ['gmail'] },
    );
    expect(result.safe).toBe(true);
  });

  it('flags Linear issue reference when linear is not active', () => {
    const result = validateAgentOutput(
      'I found LIN-1234 in the backlog.',
      { userId: 'U1', activeCapabilities: [] },
    );
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/linear/i);
  });

  it('passes Linear issue reference when linear is active', () => {
    const result = validateAgentOutput(
      'I found LIN-1234 in the backlog.',
      { userId: 'U1', activeCapabilities: ['linear'] },
    );
    expect(result.safe).toBe(true);
  });

  // ── Credential check takes priority over length ────────────────────────────

  it('credential check fires before length check', () => {
    const outputWithCred = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ ' + 'x'.repeat(20_001);
    const result = validateAgentOutput(
      outputWithCred,
      { userId: 'U1', activeCapabilities: [] },
    );
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/credential/i);
  });
});
