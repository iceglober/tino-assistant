/**
 * Wave 3 (v2.2) — § 3.3 React render test for `<CapabilityCard />`.
 *
 * Mirrors `header-restart-button.test.ts`: SSR via `react-dom/server`'s
 * `renderToString`. The card calls `useToast()` internally, so the test
 * wraps it in `<ToastProvider>` to satisfy that hook's context guard.
 *
 * The card's collapsed initial state renders enough structure to
 * verify: the human display name, the icon, the description text, the
 * status badge ("on"/"off" or "needs setup"), and the chevron SVG.
 * Field inputs are inside the collapsed details panel; we don't rely
 * on them being absent in the static markup since React renders the
 * full subtree for SSR — we just verify the visible header content.
 *
 * What this test does NOT cover:
 *   - The expand/collapse interaction (click handler).
 *   - Save flow (mocked out at the page level).
 */

import { createElement, type JSX } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CapabilityCard, type CapabilityShape } from "../../src/console-app/components/CapabilityCard.js";
import { ToastProvider } from "../../src/console-app/hooks/useToast.js";

function renderWithToast(node: JSX.Element): string {
  return renderToString(createElement(ToastProvider, null, node));
}

describe("<CapabilityCard /> — header render", () => {
  it("renders the capability display name + description from CAP_META", () => {
    const cap: CapabilityShape = {
      id: "github",
      enabled: true,
      connected: true,
      fields: [{ key: "token", label: "Personal Access Token", value: "ghp_x", secret: true }],
    };
    const html = renderWithToast(createElement(CapabilityCard, { cap }));

    // Display name + description come from the per-id CAP_META map.
    expect(html).toMatch(/GitHub/);
    expect(html).toMatch(/repos, issues, PRs/);
    // Connected → green "on" badge.
    expect(html).toMatch(/●\s*on/);
  });

  it('renders "needs setup" status when enabled but not connected', () => {
    const cap: CapabilityShape = {
      id: "linear",
      enabled: true,
      connected: false,
      fields: [],
    };
    const html = renderWithToast(createElement(CapabilityCard, { cap }));
    expect(html).toMatch(/needs setup/);
  });

  it('renders "off" badge when capability is disabled', () => {
    const cap: CapabilityShape = {
      id: "linear",
      enabled: false,
      fields: [],
    };
    const html = renderWithToast(createElement(CapabilityCard, { cap }));
    // Off badge shows "off" (lowercase) — see the connected-undefined
    // branch in CapabilityCard.
    expect(html).toMatch(/>off</);
  });

  it("renders password-type input for secret fields", () => {
    const cap: CapabilityShape = {
      id: "github",
      enabled: true,
      fields: [{ key: "token", label: "Personal Access Token", value: "ghp_x", secret: true }],
    };
    const html = renderWithToast(createElement(CapabilityCard, { cap }));
    // Secret fields render with type="password" so screen captures don't
    // leak the token even when the panel is expanded.
    expect(html).toMatch(/type="password"/);
  });
});
