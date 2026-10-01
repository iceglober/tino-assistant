import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  emailDomain,
  errorMessage,
  firstName,
  fmtAgo,
  fmtDuration,
  fmtRange,
  initials,
  plural,
  slugify,
} from "./format";

describe("fmtAgo", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  it("handles missing values", () => expect(fmtAgo(undefined, now)).toBe("—"));
  it("says just now under a minute", () => expect(fmtAgo(now - 20_000, now)).toBe("just now"));
  it("uses minutes, hours, days", () => {
    expect(fmtAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(fmtAgo(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(fmtAgo("2026-09-29T12:00:00Z", now)).toBe("2d ago");
  });
  it("speaks about the future", () => expect(fmtAgo(now + 4 * 60_000, now)).toBe("in 4m"));
});

describe("fmtRange", () => {
  it("collapses a single day", () => {
    expect(fmtRange("2026-03-02T09:00:00Z", "2026-03-02T17:00:00Z")).not.toContain("→");
  });
  it("joins two days with an arrow", () => {
    expect(fmtRange("2026-03-02T12:00:00Z", "2026-04-09T12:00:00Z")).toContain("→");
  });
  it("is a dash when either end is missing", () => expect(fmtRange(null, "2026-01-01")).toBe("—"));
});

describe("small helpers", () => {
  it("pluralizes", () => {
    expect(plural(1, "fact")).toBe("1 fact");
    expect(plural(3, "fact")).toBe("3 facts");
    expect(plural(2, "query", "queries")).toBe("2 queries");
  });
  it("slugifies like the server", () => {
    expect(slugify("Acme Corp, Inc.")).toBe("acme-corp-inc");
    expect(slugify("  Café Ünïcode  ")).toBe("cafe-unicode");
    expect(slugify("a".repeat(50), 10)).toBe("aaaaaaaaaa");
    expect(slugify("ab cd", 3)).toBe("ab");
  });
  it("makes initials", () => {
    expect(initials("Austin Rivera")).toBe("AR");
    expect(initials("austin.rivera@acme.com")).toBe("AR");
    expect(initials("x@y.z")).toBe("X");
  });
  it("finds a first name", () => {
    expect(firstName("Austin Rivera", "a@b.c")).toBe("austin");
    expect(firstName(null, "sam@acme.com")).toBe("sam");
  });
  it("reads the email domain", () => expect(emailDomain("A@Acme.COM")).toBe("acme.com"));
  it("formats durations", () => {
    expect(fmtDuration(0)).toBe("—");
    expect(fmtDuration(450)).toBe("450ms");
    expect(fmtDuration(2500)).toBe("2.5s");
  });
});

describe("errorMessage", () => {
  it("prefers the server's message", () => {
    expect(errorMessage(new ApiError(400, "bad", "slug is taken"))).toBe("slug is taken");
  });
  it("explains known codes", () => {
    expect(errorMessage(new ApiError(403, "verify_email"))).toMatch(/confirm your email/);
    expect(errorMessage(new ApiError(403, "closed_beta"))).toMatch(/private beta/);
  });
  it("falls back by status", () => {
    expect(errorMessage(new ApiError(404, "http_404", "Not Found"))).toBe("Not Found");
    expect(errorMessage(new ApiError(502, "http_502", ""))).toMatch(/snag/);
  });
  it("handles plain errors", () => expect(errorMessage(new Error("boom"))).toBe("boom"));
});
