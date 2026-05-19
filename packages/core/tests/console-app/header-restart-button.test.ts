/**
 * Wave 3.4 — regression test for the "restart" button presence.
 *
 * Acceptance item in `docs/plans/v2_1/wave_3.md` § 3.4:
 *   - "restart" button visible in the console — automatable: render `<Header>`
 *     in jsdom, assert button presence
 *
 * The plan calls for jsdom; we use `react-dom/server`'s `renderToString`
 * instead. Rationale:
 *   - jsdom + @testing-library/react would add two new devDependencies
 *     and a vitest environment switch just to assert the substring "restart"
 *     appears in static HTML.
 *   - `renderToString` ships with `react-dom` (already a dep), needs no
 *     environment, and exercises the same render path for the same
 *     assertion. The visibility we care about is "the button DOM node is
 *     rendered when a session is present" — visible to the substring test.
 *
 * What this test does NOT cover:
 *   - User interaction (click → fetch /api/admin/restart). Covered by the
 *     server-side admin-routes.test.ts which mounts the route directly.
 *   - The 30-second auto-refresh timer. Pure side-effect of `setTimeout`;
 *     trivial enough that asserting it via a jsdom timer test would add
 *     more test machinery than confidence.
 *
 * The decision is recorded in `## Open questions` of wave_3.md.
 */

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Header } from "../../src/console-app/components/Header.js";
import type { Session } from "../../src/console-app/lib/api.js";

const SESSION: Session = {
  user: { id: "U001", email: "admin@example.com", name: "Admin" },
};

describe("<Header /> — wave 3.4 restart button", () => {
  it('renders a "restart" button when a session is present', () => {
    const html = renderToString(
      createElement(MemoryRouter, null,
        createElement(Header, {
          status: "ok",
          session: SESSION,
          onSignOut: () => {},
        }),
      ),
    );

    // The button text content lives in the static markup. Match `>restart<`
    // (including the closing tag boundary) so we're not fooled by the word
    // appearing in an aria-label, tooltip, or comment.
    expect(html).toMatch(/>restart</);
    // It's labeled accessibly so screen readers announce the action.
    expect(html).toMatch(/aria-label="Restart tino"/);
    // The sign-out button still ships alongside it (regression: don't
    // accidentally replace one with the other).
    expect(html).toMatch(/>sign out</);
  });

  it("does NOT render the restart button without a session", () => {
    // The header itself still renders (logo + status), but the user-actions
    // cluster (which holds restart + sign out) is gated on session.
    const html = renderToString(
      createElement(MemoryRouter, null,
        createElement(Header, {
          status: "checking",
          session: null,
          onSignOut: () => {},
        }),
      ),
    );

    expect(html).not.toMatch(/>restart</);
    expect(html).not.toMatch(/>sign out</);
  });
});
