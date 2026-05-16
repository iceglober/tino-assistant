/**
 * Adversarial test suite for validateLogsInsightsQuery.
 *
 * This file is the audit log for the CloudWatch validator safety surface.
 * Reading the test names in `pnpm test` output should answer:
 * "What attacks does this validator block?"
 *
 * Test fixture allowlist: ['/aws/lambda/foo']
 * Production allowlist ships empty (fail-closed). Tests that exercise
 * accept-paths use the fixture allowlist, NOT the production constant.
 */

import { describe, expect, test } from "vitest";
import { validateLogsInsightsQuery } from "../../src/tools/cloudwatch/validator.js";

const ALLOWLIST = ["/aws/lambda/foo"] as const;
const ALLOWED_GROUP = "/aws/lambda/foo";
const BLOCKED_GROUP = "/aws/lambda/bar";

// ---------------------------------------------------------------------------
// Allowlist enforcement
// ---------------------------------------------------------------------------

describe("allowlist enforcement", () => {
  test("1. empty allowlist rejects every query — even a valid stats query", () => {
    const result = validateLogsInsightsQuery("fields @timestamp | stats count() by bin(1m)", ALLOWED_GROUP, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/allowlist is empty/i);
    }
  });

  test("2. allowlisted group with valid stats query is accepted", () => {
    const result = validateLogsInsightsQuery("fields @timestamp | stats count() by bin(1m)", ALLOWED_GROUP, ALLOWLIST);
    expect(result.ok).toBe(true);
  });

  test("3. non-allowlisted group is rejected even with a valid stats query", () => {
    const result = validateLogsInsightsQuery("fields @timestamp | stats count() by bin(1m)", BLOCKED_GROUP, ALLOWLIST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not in allowlist/i);
    }
  });

  test("4. allowlist is case-sensitive — /AWS/Lambda/Foo is not /aws/lambda/foo", () => {
    const result = validateLogsInsightsQuery(
      "fields @timestamp | stats count() by bin(1m)",
      "/AWS/Lambda/Foo",
      ALLOWLIST,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not in allowlist/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Forbidden-pipe rejections
// ---------------------------------------------------------------------------

describe("forbidden-pipe rejections", () => {
  test("5. | parse before stats is rejected — parse extracts arbitrary fields from log bodies", () => {
    const result = validateLogsInsightsQuery(
      "fields @message | parse @message /(?P<level>\\w+)/ | stats count() by level",
      ALLOWED_GROUP,
      ALLOWLIST,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/parse/i);
    }
  });

  test("6. | parse after stats is rejected — parse is forbidden everywhere in the query", () => {
    const result = validateLogsInsightsQuery(
      "stats count() by bin(1m) | parse @message /(?P<x>\\w+)/",
      ALLOWED_GROUP,
      ALLOWLIST,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/parse/i);
    }
  });

  test("7. | display is rejected — display selects raw fields for output", () => {
    const result = validateLogsInsightsQuery(
      "fields @timestamp | display @message | stats count() by bin(1m)",
      ALLOWED_GROUP,
      ALLOWLIST,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/display/i);
    }
  });

  test("8. | unmask is rejected — unmask de-masks redacted fields", () => {
    const result = validateLogsInsightsQuery(
      "fields @timestamp | stats count() by bin(1m) | unmask sensitive_field",
      ALLOWED_GROUP,
      ALLOWLIST,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/unmask/i);
    }
  });

  test("9. | head is rejected — head dumps raw rows", () => {
    const result = validateLogsInsightsQuery(
      "fields @message | stats count() by bin(1m) | head 5",
      ALLOWED_GROUP,
      ALLOWLIST,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/head/i);
    }
  });

  test("10. | fields @message | head — head rule fires (both head and fields-after-stats would apply; head fires first)", () => {
    // This is the plan's explicit example: fields @message | head
    // fields has no stats → would be rejected by no-stats rule anyway,
    // but head fires in the forbidden-pipe check before we even get there.
    const result = validateLogsInsightsQuery("fields @message | head 10", ALLOWED_GROUP, ALLOWLIST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/head/i);
    }
  });
});

// ---------------------------------------------------------------------------
// No-stats rejections
// ---------------------------------------------------------------------------

describe("no-stats rejections", () => {
  test("11. fields + limit without stats is rejected — raw row dump", () => {
    const result = validateLogsInsightsQuery("fields @timestamp, @message | limit 100", ALLOWED_GROUP, ALLOWLIST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/stats/i);
    }
  });

  test("12. fields + sort without stats is rejected — raw row dump with ordering", () => {
    const result = validateLogsInsightsQuery(
      "fields @timestamp, @message | sort @timestamp desc",
      ALLOWED_GROUP,
      ALLOWLIST,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/stats/i);
    }
  });

  test("13. empty query string is rejected — empty after trim", () => {
    const result = validateLogsInsightsQuery("", ALLOWED_GROUP, ALLOWLIST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Empty string hits the "query is empty" check before the stats check
      expect(result.reason).toMatch(/empty/i);
    }
  });

  test("14. query starting with display (no leading pipe) is rejected — no stats clause", () => {
    // `display @message` without a leading pipe is structurally invalid Logs Insights,
    // but the `\|\s*display` regex won't match it (no pipe). It still gets rejected
    // because there's no `| stats` clause. This documents the behavior explicitly.
    const result = validateLogsInsightsQuery("display @message", ALLOWED_GROUP, ALLOWLIST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/stats/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Fields-as-projection logic
// ---------------------------------------------------------------------------

describe("fields-as-projection logic", () => {
  test("15. fields before stats is accepted — pre-stats projection is allowed", () => {
    const result = validateLogsInsightsQuery(
      "fields @timestamp, @message | stats count() by bin(1m)",
      ALLOWED_GROUP,
      ALLOWLIST,
    );
    expect(result.ok).toBe(true);
  });

  test("16. fields after stats is rejected — terminal field projection not permitted", () => {
    const result = validateLogsInsightsQuery("stats count() by bin(1m) | fields @timestamp", ALLOWED_GROUP, ALLOWLIST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/fields.*after.*stats|terminal/i);
    }
  });

  test("17. single-field projection before stats is accepted", () => {
    const result = validateLogsInsightsQuery("fields @message | stats count()", ALLOWED_GROUP, ALLOWLIST);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Limit auto-injection
// ---------------------------------------------------------------------------

describe("limit auto-injection", () => {
  test("18. valid stats query without | limit gets | limit 1000 appended", () => {
    const result = validateLogsInsightsQuery("fields @timestamp | stats count() by bin(1m)", ALLOWED_GROUP, ALLOWLIST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rewritten).toMatch(/\|\s*limit\s+1000\s*$/i);
    }
  });

  test("19. valid stats query with | limit 5 is passed through unchanged", () => {
    const query = "fields @timestamp | stats count() by bin(1m) | limit 5";
    const result = validateLogsInsightsQuery(query, ALLOWED_GROUP, ALLOWLIST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rewritten).toBe(query);
    }
  });

  test("20. valid stats query with | limit 9999 is passed through unchanged", () => {
    const query = "fields @timestamp | stats count() by bin(1m) | limit 9999";
    const result = validateLogsInsightsQuery(query, ALLOWED_GROUP, ALLOWLIST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rewritten).toBe(query);
    }
  });
});

// ---------------------------------------------------------------------------
// Whitespace / case variations
// ---------------------------------------------------------------------------

describe("whitespace and case variations", () => {
  test("21. | STATS count() (uppercase) is accepted — validator is case-insensitive", () => {
    const result = validateLogsInsightsQuery("fields @timestamp | STATS count() by bin(1m)", ALLOWED_GROUP, ALLOWLIST);
    expect(result.ok).toBe(true);
  });

  test("22. |stats count() (no space after pipe) is accepted", () => {
    const result = validateLogsInsightsQuery("fields @timestamp |stats count() by bin(1m)", ALLOWED_GROUP, ALLOWLIST);
    expect(result.ok).toBe(true);
  });

  test("23. |  Stats   count()  (extra whitespace) is accepted", () => {
    const result = validateLogsInsightsQuery(
      "fields @timestamp |  Stats   count() by bin(1m)",
      ALLOWED_GROUP,
      ALLOWLIST,
    );
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pathological inputs
// ---------------------------------------------------------------------------

describe("pathological inputs", () => {
  test("24. query > 4096 characters is rejected — length limit", () => {
    const longQuery = `fields @timestamp | stats count() by bin(1m) ${"x".repeat(4100)}`;
    const result = validateLogsInsightsQuery(longQuery, ALLOWED_GROUP, ALLOWLIST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/4096/i);
    }
  });

  test("25. query containing only whitespace is rejected — empty after trim", () => {
    const result = validateLogsInsightsQuery("   \t\n  ", ALLOWED_GROUP, ALLOWLIST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/empty/i);
    }
  });

  test('26. "head" as part of an identifier (stats count(headers)) is NOT rejected — word boundary prevents false match', () => {
    // `\|\s*head\b` should NOT match `headers` because `headers` has a letter after `head`.
    const result = validateLogsInsightsQuery(
      "fields @timestamp | stats count(headers) by bin(1m)",
      ALLOWED_GROUP,
      ALLOWLIST,
    );
    expect(result.ok).toBe(true);
  });

  test('27. "parse" as part of an identifier (stats count(parsed_count)) is NOT rejected — word boundary prevents false match', () => {
    // `\|\s*parse\b` should NOT match `parsed_count` because `parsed_count` has `d` after `parse`.
    // Note: this tests the identifier case, not a pipe-parse case.
    // The query has no `| parse` pipe, just the word "parsed" in a field name.
    const result = validateLogsInsightsQuery(
      "fields @timestamp | stats sum(parsed_count) by bin(1m)",
      ALLOWED_GROUP,
      ALLOWLIST,
    );
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rewritten query content
// ---------------------------------------------------------------------------

describe("rewritten query content", () => {
  test("28. rewritten query preserves the original query text before appending limit", () => {
    const original = "fields @timestamp, @message | stats count() by bin(5m)";
    const result = validateLogsInsightsQuery(original, ALLOWED_GROUP, ALLOWLIST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rewritten).toBe(`${original} | limit 1000`);
    }
  });

  test("29. complex multi-pipe stats query is accepted and limit is injected", () => {
    const result = validateLogsInsightsQuery(
      "fields @timestamp, @message | filter @message like /ERROR/ | stats count() by bin(5m)",
      ALLOWED_GROUP,
      ALLOWLIST,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rewritten).toMatch(/\|\s*limit\s+1000\s*$/i);
    }
  });
});
