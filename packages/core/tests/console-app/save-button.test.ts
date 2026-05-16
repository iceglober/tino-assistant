/**
 * Wave 3 (v2.2) — § 3.3 React render test for `<SaveButton />`.
 *
 * Mirrors `header-restart-button.test.ts`: SSR via `react-dom/server`'s
 * `renderToString`. The button is a pure leaf component (no hooks, no
 * context, no `window`) so the SSR output equals the DOM output for
 * the static markup we care about — label text, disabled state, CSS
 * class composition.
 *
 * What this test does NOT cover:
 *   - Click handlers. Covered by integration tests at the page level
 *     (and indirectly by route tests when the button POSTs to /api/...).
 */

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SaveButton } from "../../src/console-app/components/SaveButton.js";

describe("<SaveButton /> — render states", () => {
  it("renders the idle label when state is idle", () => {
    const html = renderToString(
      createElement(SaveButton, {
        state: "idle",
        idleLabel: "save",
        onClick: () => {},
      }),
    );
    // The label text is the visible content; the button is enabled.
    expect(html).toMatch(/>save</);
    expect(html).not.toMatch(/disabled/);
  });

  it("renders the saving label and is disabled when state is saving", () => {
    const html = renderToString(
      createElement(SaveButton, {
        state: "saving",
        idleLabel: "save",
        onClick: () => {},
      }),
    );
    // Default savingLabel is "saving…"
    expect(html).toMatch(/saving/);
    // The button is disabled while saving (prevents double-submit).
    expect(html).toMatch(/disabled/);
    // The `saving` state class is composed into the className.
    expect(html).toMatch(/class="[^"]*saving[^"]*"/);
  });

  it("renders the saved checkmark when state is saved", () => {
    const html = renderToString(
      createElement(SaveButton, {
        state: "saved",
        idleLabel: "save",
        onClick: () => {},
      }),
    );
    // ✓ saved is the default savedLabel.
    expect(html).toMatch(/saved/);
    expect(html).toMatch(/class="[^"]*saved[^"]*"/);
  });

  it("renders the error label when state is error", () => {
    const html = renderToString(
      createElement(SaveButton, {
        state: "error",
        idleLabel: "save",
        onClick: () => {},
      }),
    );
    expect(html).toMatch(/retry/);
    expect(html).toMatch(/class="[^"]*save-error[^"]*"/);
  });
});
