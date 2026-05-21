import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Header } from "../../src/console-app/components/Header.js";
import type { Session } from "../../src/console-app/lib/api.js";

const SESSION: Session = {
  user: { id: "U001", email: "admin@example.com", name: "Admin", role: "admin" },
};

describe("<Header /> — session-gated rendering", () => {
  it("renders sign out button when session is present", () => {
    const html = renderToString(
      createElement(MemoryRouter, null,
        createElement(Header, {
          status: "ok",
          session: SESSION,
          onSignOut: () => {},
        }),
      ),
    );

    expect(html).toMatch(/>sign out</);
    expect(html).toContain("admin@example.com");
  });

  it("does NOT render user controls without a session", () => {
    const html = renderToString(
      createElement(MemoryRouter, null,
        createElement(Header, {
          status: "checking",
          session: null,
          onSignOut: () => {},
        }),
      ),
    );

    expect(html).not.toMatch(/>sign out</);
  });
});
