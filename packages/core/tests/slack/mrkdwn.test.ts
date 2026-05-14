import { describe, expect, test } from 'vitest';
import { toSlackMrkdwn } from '../../src/slack/mrkdwn.js';

describe('toSlackMrkdwn', () => {
  test('plain text passes through unchanged', () => {
    expect(toSlackMrkdwn('hello world')).toBe('hello world');
  });

  test('**bold** → *bold*', () => {
    expect(toSlackMrkdwn('this is **bold** text')).toBe('this is *bold* text');
  });

  test('__bold__ → *bold*', () => {
    expect(toSlackMrkdwn('this is __bold__ text')).toBe('this is *bold* text');
  });

  test('multiple bold spans on one line', () => {
    expect(toSlackMrkdwn('**foo** and **bar**')).toBe('*foo* and *bar*');
  });

  test('# H1 header → *H1*', () => {
    expect(toSlackMrkdwn('# Heading\nbody')).toBe('*Heading*\nbody');
  });

  test('## H2 header → *H2*', () => {
    expect(toSlackMrkdwn('## Sub heading')).toBe('*Sub heading*');
  });

  test('###### H6 header → *H6*', () => {
    expect(toSlackMrkdwn('###### tiny')).toBe('*tiny*');
  });

  test('header in middle of text is converted', () => {
    expect(toSlackMrkdwn('intro\n# Heading\nbody')).toBe('intro\n*Heading*\nbody');
  });

  test('~~strike~~ → ~strike~', () => {
    expect(toSlackMrkdwn('~~old~~ new')).toBe('~old~ new');
  });

  test('Markdown link → Slack <url|text>', () => {
    expect(toSlackMrkdwn('see [the docs](https://example.com)')).toBe('see <https://example.com|the docs>');
  });

  test('_italic_ unchanged (already valid in both)', () => {
    expect(toSlackMrkdwn('this is _italic_')).toBe('this is _italic_');
  });

  test('inline `code` unchanged', () => {
    expect(toSlackMrkdwn('use `git status`')).toBe('use `git status`');
  });

  test('triple-backtick code block unchanged', () => {
    expect(toSlackMrkdwn('```\nconst x = 1;\n```')).toBe('```\nconst x = 1;\n```');
  });

  test('bullet list with - unchanged', () => {
    expect(toSlackMrkdwn('- one\n- two')).toBe('- one\n- two');
  });

  test('numbered list unchanged', () => {
    expect(toSlackMrkdwn('1. first\n2. second')).toBe('1. first\n2. second');
  });

  test('combined: header + bold + link in one input', () => {
    const input = '# Summary\nThis is **important** — see [link](https://example.com).';
    const expected = '*Summary*\nThis is *important* — see <https://example.com|link>.';
    expect(toSlackMrkdwn(input)).toBe(expected);
  });

  test('does not eat asterisks not part of bold', () => {
    // Single asterisks at word boundaries are valid Slack bold already.
    expect(toSlackMrkdwn('*already slack bold*')).toBe('*already slack bold*');
  });
});
