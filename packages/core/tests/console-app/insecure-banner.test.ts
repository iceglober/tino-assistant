/**
 * Wave 3 (v2.2) — § 3.3 React render test for `<InsecureBanner />`.
 *
 * Mirrors `header-restart-button.test.ts`: SSR via `react-dom/server`'s
 * `renderToString`, no jsdom, no `@testing-library/react`. The banner
 * gates on `window.location` — under SSR `typeof window === "undefined"`,
 * so the early return fires and the rendered output is the empty string.
 *
 * Why we don't test the warning DOM here:
 *   - asserting on the rendered <div role="alert"> would require a DOM
 *     environment + a mocked window.location. That adds a dev dep
 *     (jsdom) for one substring assertion. The SSR-null path is the
 *     one exercised by Vite SSR/test runs anyway, which is the
 *     contract this test pins.
 *
 * What this test does NOT cover:
 *   - The visible banner DOM (production HTTP-served deployment).
 *     Defer until a wave introduces jsdom for full DOM assertions.
 */

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InsecureBanner } from "../../src/console-app/components/InsecureBanner.js";

describe("<InsecureBanner /> — SSR null-render path", () => {
  it("renders nothing when `window` is undefined (SSR / test)", () => {
    const html = renderToString(createElement(InsecureBanner));
    // Early return on `typeof window === 'undefined'` — empty render.
    expect(html).toBe("");
  });

  it("does not throw when rendered without props", () => {
    // Regression: the banner takes no props; rendering it bare must
    // never blow up the SSR pipeline regardless of environment.
    expect(() => renderToString(createElement(InsecureBanner))).not.toThrow();
  });
});
