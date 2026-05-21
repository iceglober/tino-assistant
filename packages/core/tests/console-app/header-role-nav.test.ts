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

describe("<Header /> — nav rendering", () => {
  it("renders user email and sign out when session present", () => {
    const html = renderHeader(adminSession);
    expect(html).toContain("admin@example.com");
    expect(html).toMatch(/>sign out</);
  });

  it("renders member email and sign out", () => {
    const html = renderHeader(memberSession);
    expect(html).toContain("member@example.com");
    expect(html).toMatch(/>sign out</);
  });

  it("does not render user nav without a session", () => {
    const html = renderHeader(null);
    expect(html).not.toMatch(/>sign out</);
    expect(html).not.toContain("admin@example.com");
  });

  it("renders status indicator", () => {
    const html = renderHeader(adminSession);
    expect(html).toContain("running");
  });
});
