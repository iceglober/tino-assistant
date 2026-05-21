import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Header } from "../../src/console-app/components/Header.js";
import type { Session } from "../../src/console-app/lib/api.js";

const adminSession: Session = {
  user: { id: "U001", email: "admin@example.com", name: "Admin", role: "admin" },
};

const memberSession: Session = {
  user: { id: "U002", email: "member@example.com", name: "Member", role: "member" },
};

function renderHeader(session: Session | null): string {
  return renderToString(
    createElement(MemoryRouter, null,
      createElement(Header, {
        status: "ok",
        session,
        onSignOut: () => {},
      }),
    ),
  );
}

describe("<Header /> — role-conditional nav", () => {
  it("admin nav includes users link", () => {
    const html = renderHeader(adminSession);
    expect(html).toMatch(/aria-label="Users"/);
    expect(html).toMatch(/>users</);
  });

  it("admin nav still includes common links", () => {
    const html = renderHeader(adminSession);
    expect(html).toMatch(/aria-label="Activity"/);
    expect(html).toMatch(/aria-label="Privacy settings"/);
    expect(html).toMatch(/>sign out</);
  });

  it("member nav lacks admin links", () => {
    const html = renderHeader(memberSession);
    expect(html).not.toMatch(/aria-label="Users"/);
    expect(html).not.toMatch(/>users</);
  });

  it("member nav includes common links", () => {
    const html = renderHeader(memberSession);
    expect(html).toMatch(/aria-label="Activity"/);
    expect(html).toMatch(/>activity</);
    expect(html).toMatch(/aria-label="Privacy settings"/);
    expect(html).toMatch(/>privacy</);
    expect(html).toMatch(/>sign out</);
  });

  it("session with no role (legacy) hides admin links", () => {
    const legacySession: Session = {
      user: { id: "U003", email: "legacy@example.com" },
    };
    const html = renderHeader(legacySession);
    expect(html).not.toMatch(/aria-label="Users"/);
  });
});
