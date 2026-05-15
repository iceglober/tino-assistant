/**
 * Self-contained HTML page for the tino config console.
 * No build step, no framework — inline CSS + JS only.
 *
 * Design: warm professional service aesthetic. Dark navy base, warm amber accent,
 * silver neutral. 3:4 proportional system. System font stack + monospace for values.
 *
 * Three screens based on setup state:
 *   1. Welcome — no Slack configured yet. One job: connect Slack.
 *   2. Basics  — Slack connected, no bedrock.modelId. Set model + admin user.
 *   3. Console — fully configured. Capability grid + raw config + compliance.
 *
 * Interaction design: labels above inputs, blur validation, inline errors,
 * success feedback, progressive disclosure, one primary action per screen.
 */
export function getConsoleHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/png" href="/assets/tino-logo.png">
  <title>tino — setup</title>
  <style>
    /* ── Reset ─────────────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Design tokens ──────────────────────────────────────────────────
       Proportional system: 3:4 ratio (×0.75)
       Spacing scale: 4 6 8 12 16 21 28 37px
       Type scale: 11 14 19 25px (body at 14px)
       Color palette: warm professional service
         bg-deep:    #141c27  (deepest background)
         bg-base:    #1a2332  (page background — dark navy suit)
         bg-raised:  #1f2b3d  (card surface)
         bg-inset:   #162030  (input / inset surface)
         border:     #2a3a50  (structural borders)
         border-sub: #223040  (subtle dividers)
         text-prim:  #e8ddd0  (warm primary text — warm not cold)
         text-sec:   #8a96a8  (cool secondary — recedes)
         text-dim:   #4a5568  (dimmed / placeholder)
         accent:     #c8956a  (warm amber — butler's glove)
         accent-dim: #8a5a3a  (darker accent for borders)
         silver:     #a8b0bc  (silver cloche — neutral highlights)
         ok:         #6aab7a  (success green — muted, not neon)
         err:        #c06060  (error red — warm, not harsh)
         mono:       'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace
    ─────────────────────────────────────────────────────────────────── */

    :root {
      --bg-deep:   #141c27;
      --bg-base:   #1a2332;
      --bg-raised: #1f2b3d;
      --bg-inset:  #162030;
      --border:    #2a3a50;
      --border-sub:#223040;
      --text-prim: #e8ddd0;
      --text-sec:  #8a96a8;
      --text-dim:  #4a5568;
      --accent:    #c8956a;
      --accent-dim:#7a4e2a;
      --silver:    #a8b0bc;
      --ok:        #6aab7a;
      --err:       #c06060;
      --mono: 'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
      --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      --radius: 6px;
      --radius-sm: 4px;
    }

    /* ── Base ───────────────────────────────────────────────────────────── */
    html { font-size: 14px; }
    body {
      font-family: var(--sans);
      font-size: 1rem;
      line-height: 1.5;
      background: var(--bg-base);
      color: var(--text-prim);
      min-height: 100vh;
    }

    /* ── Layout ─────────────────────────────────────────────────────────── */
    .page {
      max-width: 720px;
      margin: 0 auto;
      padding: clamp(16px, 4vw, 28px);
    }

    /* ── Screen visibility ──────────────────────────────────────────────── */
    .screen { display: none; }
    .screen.active { display: block; }

    /* ── Logo block ─────────────────────────────────────────────────────── */
    .logo-block {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 37px;
    }
    .logo-img {
      width: 40px;
      height: 40px;
      border-radius: var(--radius);
      flex-shrink: 0;
    }
    .logo-wordmark {
      font-size: 1.357rem;
      font-weight: 600;
      color: var(--text-prim);
      letter-spacing: -0.01em;
    }

    /* ── Welcome / Basics screen ────────────────────────────────────────── */
    .setup-screen {
      max-width: 480px;
    }
    .setup-heading {
      font-size: 1.714rem; /* ~24px */
      font-weight: 600;
      color: var(--text-prim);
      letter-spacing: -0.02em;
      margin-bottom: 8px;
      line-height: 1.2;
    }
    .setup-lead {
      font-size: 1rem;
      color: var(--text-sec);
      line-height: 1.6;
      margin-bottom: 28px;
    }

    /* Success banner — shown after Slack connects */
    .success-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      background: rgba(106, 171, 122, 0.08);
      border: 1px solid rgba(106, 171, 122, 0.25);
      border-radius: var(--radius);
      padding: 10px 14px;
      margin-bottom: 28px;
      font-size: 0.929rem;
      color: var(--ok);
    }
    .success-banner-icon {
      font-size: 1.1rem;
      flex-shrink: 0;
    }

    /* ── Form field group — label above input ───────────────────────────── */
    .field-group {
      margin-bottom: 16px;
    }
    .field-label {
      display: block;
      font-size: 0.857rem;
      font-weight: 500;
      color: var(--text-prim);
      margin-bottom: 5px;
    }
    .field-label-mono {
      font-family: var(--mono);
      font-size: 0.786rem;
      color: var(--silver);
    }
    .field-input-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .field-input {
      flex: 1;
      min-width: 0;
      background: var(--bg-inset);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-prim);
      font-family: var(--mono);
      font-size: 0.857rem;
      padding: 8px 10px;
      outline: none;
      transition: border-color 100ms, box-shadow 100ms;
      min-height: 36px;
      width: 100%;
    }
    .field-input:focus-visible {
      border-color: var(--accent-dim);
      box-shadow: 0 0 0 2px rgba(200, 149, 106, 0.25);
    }
    .field-input:hover:not(:focus-visible):not([aria-invalid="true"]) {
      border-color: #3a4e68;
    }
    .field-input[aria-invalid="true"] {
      border-color: var(--err);
      box-shadow: 0 0 0 2px rgba(192, 96, 96, 0.15);
    }
    .field-input.field-success {
      border-color: var(--ok);
      box-shadow: 0 0 0 2px rgba(106, 171, 122, 0.2);
    }
    .field-input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .field-input::placeholder { color: var(--text-dim); }

    /* Helper text below input */
    .field-hint {
      font-size: 0.786rem;
      color: var(--text-dim);
      margin-top: 4px;
      line-height: 1.5;
    }

    /* Inline error message */
    .field-error {
      font-size: 0.786rem;
      color: var(--err);
      margin-top: 4px;
      line-height: 1.4;
      opacity: 0;
      transform: translateY(-2px);
      transition: opacity 150ms cubic-bezier(0.0, 0, 0.2, 1),
                  transform 150ms cubic-bezier(0.0, 0, 0.2, 1);
      pointer-events: none;
    }
    .field-error.visible {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }

    /* Reveal button for password fields */
    .reveal-btn {
      background: none;
      border: 1px solid var(--border);
      color: var(--text-dim);
      cursor: pointer;
      padding: 7px 10px;
      font-size: 0.786rem;
      font-family: var(--sans);
      line-height: 1;
      border-radius: var(--radius-sm);
      flex-shrink: 0;
      min-height: 36px;
      min-width: 48px;
      transition: color 100ms, border-color 100ms, background 100ms;
    }
    .reveal-btn:hover { color: var(--silver); border-color: #3a4e68; background: rgba(168,176,188,0.05); }
    .reveal-btn:active { transform: scale(0.97); }
    .reveal-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    /* ── Buttons ────────────────────────────────────────────────────────── */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: var(--bg-inset);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-sec);
      font-family: var(--sans);
      font-size: 0.857rem;
      padding: 8px 14px;
      cursor: pointer;
      transition: background 100ms, border-color 100ms, color 100ms, transform 100ms, opacity 100ms;
      min-height: 36px;
      min-width: 44px;
      white-space: nowrap;
    }
    .btn:hover:not(:disabled):not(.saving) {
      background: var(--bg-raised);
      border-color: #3a4e68;
      color: var(--text-prim);
    }
    .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .btn:active:not(:disabled):not(.saving) { transform: scale(0.97); }
    .btn:disabled, .btn[aria-disabled="true"] {
      opacity: 0.4;
      cursor: not-allowed;
      pointer-events: none;
    }

    /* Primary button */
    .btn-primary {
      background: rgba(200, 149, 106, 0.1);
      border-color: var(--accent-dim);
      color: var(--accent);
      font-weight: 500;
    }
    .btn-primary:hover:not(:disabled):not(.saving) {
      background: rgba(200, 149, 106, 0.18);
      border-color: var(--accent);
      color: var(--accent);
    }

    /* Large primary — for setup screens */
    .btn-primary-lg {
      font-size: 0.929rem;
      padding: 10px 20px;
      min-height: 42px;
    }

    /* Loading state */
    .btn.saving {
      opacity: 0.65;
      cursor: wait;
      pointer-events: none;
    }

    /* Success state */
    .btn.saved {
      background: rgba(106, 171, 122, 0.12);
      border-color: rgba(106, 171, 122, 0.5);
      color: var(--ok);
    }

    /* Error state */
    .btn.save-error {
      background: rgba(192, 96, 96, 0.1);
      border-color: rgba(192, 96, 96, 0.5);
      color: var(--err);
    }

    /* Danger button */
    .btn-danger {
      color: var(--err);
      border-color: rgba(192, 96, 96, 0.3);
    }
    .btn-danger:hover:not(:disabled) {
      background: rgba(192, 96, 96, 0.08);
      border-color: var(--err);
    }

    .btn-row {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
      align-items: center;
    }

    /* Ghost link button */
    .btn-ghost {
      background: none;
      border: none;
      color: var(--text-dim);
      font-size: 0.857rem;
      cursor: pointer;
      padding: 4px 0;
      font-family: var(--sans);
      text-decoration: underline;
      text-underline-offset: 2px;
      transition: color 100ms;
    }
    .btn-ghost:hover { color: var(--text-sec); }
    .btn-ghost:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }

    /* ── Divider ────────────────────────────────────────────────────────── */
    .divider {
      border: none;
      border-top: 1px solid var(--border-sub);
      margin: 28px 0;
    }

    /* ── Help block ─────────────────────────────────────────────────────── */
    .help-block {
      font-size: 0.857rem;
      color: var(--text-dim);
      line-height: 1.6;
    }
    .help-block a {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid rgba(200, 149, 106, 0.3);
      transition: border-color 100ms, color 100ms;
    }
    .help-block a:hover { color: var(--text-prim); border-color: var(--text-prim); }
    .help-block a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }

    /* ── Step list ──────────────────────────────────────────────────────── */
    .step-list {
      list-style: none;
      padding: 0;
      margin: 8px 0 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .step-list li {
      display: flex;
      gap: 8px;
      font-size: 0.857rem;
      color: var(--text-dim);
      line-height: 1.5;
    }
    .step-num {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--bg-raised);
      border: 1px solid var(--border);
      font-size: 0.714rem;
      font-weight: 600;
      color: var(--text-dim);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 2px;
    }

    /* ── Console screen ─────────────────────────────────────────────────── */

    /* Header */
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-bottom: 21px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 21px;
    }
    .header-logo {
      width: 36px;
      height: 36px;
      border-radius: var(--radius);
      flex-shrink: 0;
    }
    .header-wordmark {
      font-size: 1.357rem;
      font-weight: 600;
      color: var(--text-prim);
      letter-spacing: -0.01em;
    }
    .header-sub {
      font-size: 0.786rem;
      color: var(--text-dim);
      margin-top: 1px;
    }
    .header-status {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.786rem;
      color: var(--text-dim);
    }
    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-dim);
      flex-shrink: 0;
    }
    .status-dot.ok { background: var(--ok); }

    /* Section labels */
    .section-label {
      font-size: 0.786rem;
      font-weight: 600;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--text-dim);
      margin-bottom: 12px;
    }

    /* ── Capability grid ────────────────────────────────────────────────── */
    .cap-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      margin-bottom: 28px;
    }
    @media (max-width: 520px) {
      .cap-grid { grid-template-columns: 1fr; }
    }

    /* ── Capability card ────────────────────────────────────────────────── */
    .cap-card {
      background: var(--bg-raised);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      transition: border-color 150ms;
    }
    .cap-card.state-ok { border-left: 3px solid var(--ok); }
    .cap-card.state-warn { border-left: 3px solid var(--err); }
    .cap-card.state-disabled { border-left: 3px solid var(--border); }

    .cap-card-header {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 14px 14px 10px;
      cursor: pointer;
      user-select: none;
      transition: background 100ms;
    }
    .cap-card-header:hover { background: rgba(200, 149, 106, 0.04); }
    .cap-card-header:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }

    .cap-card-icon {
      font-size: 1.286rem;
      line-height: 1;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .cap-card-meta {
      flex: 1;
      min-width: 0;
    }
    .cap-card-name {
      font-size: 0.929rem;
      font-weight: 600;
      color: var(--text-prim);
      margin-bottom: 2px;
    }
    .cap-card-desc {
      font-size: 0.786rem;
      color: var(--text-sec);
      line-height: 1.4;
    }

    .cap-card-status {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }

    .status-connected {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.714rem;
      color: var(--ok);
      font-weight: 500;
    }

    .btn-setup {
      font-size: 0.786rem;
      padding: 4px 10px;
      min-height: 28px;
    }

    /* Toggle switch */
    .toggle-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .toggle {
      position: relative;
      display: inline-block;
      width: 32px;
      height: 18px;
      flex-shrink: 0;
    }
    .toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
    .toggle-track {
      position: absolute;
      inset: 0;
      background: var(--border);
      border-radius: 18px;
      cursor: pointer;
      transition: background 150ms cubic-bezier(0.65, 0, 0.35, 1);
    }
    .toggle:hover .toggle-track { background: #3a4e68; }
    .toggle input:checked ~ .toggle-track { background: var(--accent-dim); }
    .toggle input:checked:hover ~ .toggle-track { background: #9a6040; }
    .toggle:active .toggle-track { transform: scale(0.96); }
    .toggle input:disabled ~ .toggle-track { opacity: 0.4; cursor: not-allowed; }
    .toggle input:disabled ~ .toggle-thumb { opacity: 0.4; cursor: not-allowed; }
    .toggle-thumb {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 12px;
      height: 12px;
      background: var(--text-dim);
      border-radius: 50%;
      transition: transform 150ms cubic-bezier(0.65, 0, 0.35, 1),
                  background 150ms cubic-bezier(0.65, 0, 0.35, 1);
      pointer-events: none;
    }
    .toggle input:checked ~ .toggle-thumb {
      transform: translateX(14px);
      background: var(--accent);
    }
    .toggle input:focus-visible ~ .toggle-track {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    /* Expand chevron */
    .cap-chevron {
      width: 14px;
      height: 14px;
      color: var(--text-dim);
      flex-shrink: 0;
      transition: transform 200ms cubic-bezier(0.65, 0, 0.35, 1);
      margin-top: 3px;
    }
    .cap-card.open .cap-chevron { transform: rotate(90deg); }

    /* Card detail expand/collapse */
    .cap-detail-wrap {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 220ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .cap-card.open .cap-detail-wrap { grid-template-rows: 1fr; }
    .cap-detail-inner { overflow: hidden; }
    .cap-detail {
      padding: 0 14px 14px 14px;
      border-top: 1px solid var(--border-sub);
    }

    /* Detail sections */
    .detail-section { margin-top: 14px; }
    .detail-section:first-child { margin-top: 12px; }
    .detail-label {
      font-size: 0.714rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-dim);
      margin-bottom: 8px;
    }

    /* findWork section */
    .fw-row {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      flex-wrap: wrap;
    }
    .fw-toggle-group {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-top: 2px;
    }
    .fw-label { font-size: 0.857rem; color: var(--text-sec); }
    .fw-interval-group { flex: 1; min-width: 120px; }
    .fw-interval-label { display: block; font-size: 0.786rem; color: var(--text-dim); margin-bottom: 4px; }
    .fw-interval-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.786rem;
      color: var(--text-dim);
    }
    .fw-interval-input {
      width: 60px;
      background: var(--bg-inset);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-prim);
      font-family: var(--mono);
      font-size: 0.786rem;
      padding: 5px 6px;
      text-align: center;
      min-height: 32px;
      outline: none;
      transition: border-color 100ms, box-shadow 100ms;
    }
    .fw-interval-input:focus-visible {
      border-color: var(--accent-dim);
      box-shadow: 0 0 0 2px rgba(200, 149, 106, 0.25);
    }
    .fw-interval-input:hover:not(:focus-visible) { border-color: #3a4e68; }
    .fw-interval-input[aria-invalid="true"] {
      border-color: var(--err);
      box-shadow: 0 0 0 2px rgba(192, 96, 96, 0.15);
    }

    /* Empty state */
    .empty {
      color: var(--text-dim);
      font-size: 0.857rem;
      font-style: italic;
      padding: 8px 0;
    }
    .empty-state { padding: 10px 0 4px; }
    .empty-state-msg {
      font-size: 0.857rem;
      color: var(--text-sec);
      line-height: 1.5;
      margin-bottom: 6px;
    }
    .empty-state-link {
      font-size: 0.786rem;
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid rgba(200, 149, 106, 0.3);
      transition: border-color 100ms, color 100ms;
    }
    .empty-state-link:hover { color: var(--text-prim); border-color: var(--text-prim); }
    .empty-state-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }

    /* ── Raw config section ─────────────────────────────────────────────── */
    .raw-section { margin-bottom: 28px; }
    .raw-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      color: var(--text-dim);
      font-size: 0.786rem;
      font-weight: 500;
      margin-bottom: 12px;
      background: none;
      border: none;
      padding: 4px 0;
      min-height: 32px;
      transition: color 100ms;
    }
    .raw-toggle:hover { color: var(--text-sec); }
    .raw-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
    .raw-chevron {
      width: 12px;
      height: 12px;
      transition: transform 200ms cubic-bezier(0.65, 0, 0.35, 1);
    }
    .raw-section.open .raw-chevron { transform: rotate(90deg); }
    .raw-body-wrap {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 220ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .raw-section.open .raw-body-wrap { grid-template-rows: 1fr; }
    .raw-body-inner { overflow: hidden; }
    .raw-body { padding-bottom: 4px; }

    /* Add entry form */
    .add-form { display: flex; flex-direction: column; gap: 10px; }
    .add-form-fields {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: flex-end;
    }
    .add-form-fields .field-group {
      flex: 1;
      min-width: 120px;
      margin-bottom: 0;
    }

    /* ── Table ──────────────────────────────────────────────────────────── */
    .config-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.786rem;
      margin-bottom: 16px;
    }
    .config-table th {
      text-align: left;
      padding: 0 8px 8px 0;
      color: var(--text-dim);
      font-weight: 500;
      font-size: 0.714rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border-bottom: 1px solid var(--border-sub);
    }
    .config-table td {
      padding: 7px 8px 7px 0;
      border-bottom: 1px solid var(--border-sub);
      vertical-align: middle;
    }
    .config-table tr:last-child td { border-bottom: none; }
    .config-table .col-key { font-family: var(--mono); color: var(--silver); white-space: nowrap; padding-right: 16px; }
    .config-table .col-val { font-family: var(--mono); color: var(--text-sec); word-break: break-all; }
    .config-table .col-ts { color: var(--text-dim); white-space: nowrap; padding-right: 12px; }
    .config-table .col-act { white-space: nowrap; }

    /* Inline delete confirmation */
    .delete-confirm {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      opacity: 0;
      transform: translateX(8px);
      transition: opacity 200ms cubic-bezier(0.16, 1, 0.3, 1),
                  transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
      position: absolute;
      right: 0;
      top: 50%;
      translate: 0 -50%;
      background: var(--bg-raised);
      border: 1px solid rgba(192, 96, 96, 0.3);
      border-radius: var(--radius-sm);
      padding: 3px 6px;
      white-space: nowrap;
      z-index: 10;
    }
    .delete-confirm.visible { opacity: 1; transform: translateX(0); pointer-events: auto; }
    .col-act { position: relative; }
    .delete-confirm-text { font-size: 0.714rem; color: var(--err); }
    .delete-confirm-yes {
      background: none; border: none; color: var(--err); font-size: 0.714rem; font-weight: 600;
      cursor: pointer; padding: 2px 4px; border-radius: 2px; min-height: 24px; min-width: 44px;
    }
    .delete-confirm-yes:hover { background: rgba(192, 96, 96, 0.12); }
    .delete-confirm-yes:focus-visible { outline: 2px solid var(--err); outline-offset: 1px; }
    .delete-confirm-no {
      background: none; border: none; color: var(--text-dim); font-size: 0.714rem;
      cursor: pointer; padding: 2px 4px; border-radius: 2px; min-height: 24px; min-width: 44px;
    }
    .delete-confirm-no:hover { color: var(--text-sec); }
    .delete-confirm-no:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

    /* ── Compliance section ─────────────────────────────────────────────── */
    .compliance-section { margin-bottom: 28px; }
    .compliance-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      color: var(--text-dim);
      font-size: 0.786rem;
      font-weight: 500;
      margin-bottom: 12px;
      background: none;
      border: none;
      padding: 4px 0;
      min-height: 32px;
      transition: color 100ms;
    }
    .compliance-toggle:hover { color: var(--text-sec); }
    .compliance-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
    .compliance-chevron {
      width: 12px;
      height: 12px;
      transition: transform 200ms cubic-bezier(0.65, 0, 0.35, 1);
    }
    .compliance-section.open .compliance-chevron { transform: rotate(90deg); }
    .compliance-body-wrap {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 220ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .compliance-section.open .compliance-body-wrap { grid-template-rows: 1fr; }
    .compliance-body-inner { overflow: hidden; }
    .compliance-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.786rem;
    }
    .compliance-table th {
      text-align: left;
      padding: 0 8px 8px 0;
      color: var(--text-dim);
      font-weight: 500;
      font-size: 0.714rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border-bottom: 1px solid var(--border-sub);
    }
    .compliance-table td {
      padding: 7px 8px 7px 0;
      border-bottom: 1px solid var(--border-sub);
      vertical-align: middle;
    }
    .compliance-table tr:last-child td { border-bottom: none; }
    .compliance-table .col-service { font-family: var(--mono); color: var(--silver); white-space: nowrap; padding-right: 16px; }
    .compliance-table .col-status { white-space: nowrap; }
    .compliance-table .col-detail { color: var(--text-sec); font-size: 0.714rem; }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.714rem;
      font-family: var(--mono);
      padding: 2px 6px;
      border-radius: 3px;
    }
    .status-ok    { background: rgba(106, 171, 122, 0.12); color: var(--ok); }
    .status-warn  { background: rgba(200, 149, 106, 0.12); color: var(--accent); }
    .status-err   { background: rgba(192, 96, 96, 0.12);   color: var(--err); }
    .status-dim   { background: rgba(168, 176, 188, 0.1);  color: var(--silver); }
    .compliance-loading { color: var(--text-dim); font-size: 0.857rem; font-style: italic; padding: 8px 0; }

    /* ── Health footer ──────────────────────────────────────────────────── */
    .health-footer {
      margin-top: 28px;
      padding-top: 16px;
      border-top: 1px solid var(--border-sub);
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .health-uptime { font-size: 0.714rem; color: var(--text-dim); }
    .health-tools { font-size: 0.714rem; color: var(--text-dim); }
    .health-tools strong { color: var(--text-sec); font-weight: 500; }

    /* ── Toast ──────────────────────────────────────────────────────────── */
    #toast {
      position: fixed;
      bottom: 21px;
      left: 50%;
      transform: translateX(-50%) translateY(8px);
      background: var(--bg-raised);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 8px 16px;
      font-size: 0.857rem;
      color: var(--text-sec);
      opacity: 0;
      pointer-events: none;
      transition: opacity 200ms cubic-bezier(0.16, 1, 0.3, 1),
                  transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
      white-space: nowrap;
      z-index: 100;
    }
    #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); pointer-events: auto; }
    #toast.ok  { border-color: var(--ok);  color: var(--ok); }
    #toast.err { border-color: var(--err); color: var(--err); }
    #toast-undo {
      background: none; border: none; color: inherit; font: inherit; font-weight: 600;
      cursor: pointer; padding: 0 0 0 10px; text-decoration: underline; opacity: 0.85;
    }
    #toast-undo:hover { opacity: 1; }
    #toast-undo:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; border-radius: 2px; }

    /* ── Responsive ─────────────────────────────────────────────────────── */
    @media (max-width: 480px) {
      .config-table .col-ts { display: none; }
      .add-form-fields { flex-direction: column; }
      .add-form-fields .field-group { width: 100%; }
      .fw-row { flex-direction: column; gap: 10px; }
    }

    /* ── Reduced motion ─────────────────────────────────────────────────── */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body>
  <div class="page">

    <!-- ── Screen 1: Welcome ────────────────────────────────────────────── -->
    <div id="screen-welcome" class="screen">
      <div class="logo-block">
        <img src="/assets/tino-logo.png" alt="tino" class="logo-img">
        <span class="logo-wordmark">tino</span>
      </div>
      <div class="setup-screen">
        <h1 class="setup-heading">welcome to tino.</h1>
        <p class="setup-lead">
          let's get you connected. first, we need your Slack tokens
          so tino can join your workspace.
        </p>

        <div class="field-group">
          <label class="field-label" for="slack-bot-token">Bot Token</label>
          <div class="field-input-wrap">
            <input class="field-input" type="password" id="slack-bot-token"
                   placeholder="xoxb-…"
                   autocomplete="off"
                   aria-describedby="slack-bot-token-hint slack-bot-token-error"
                   onblur="validateSlackToken('slack-bot-token', 'xoxb-', 'slack-bot-token-error')">
            <button class="reveal-btn" type="button"
                    onclick="toggleReveal('slack-bot-token', this)"
                    aria-label="Reveal Bot Token">show</button>
          </div>
          <div class="field-hint" id="slack-bot-token-hint">
            Slack → your app → OAuth &amp; Permissions → Bot User OAuth Token (starts with xoxb-)
          </div>
          <div class="field-error" id="slack-bot-token-error" role="alert" aria-live="polite"></div>
        </div>

        <div class="field-group">
          <label class="field-label" for="slack-app-token">App Token</label>
          <div class="field-input-wrap">
            <input class="field-input" type="password" id="slack-app-token"
                   placeholder="xapp-…"
                   autocomplete="off"
                   aria-describedby="slack-app-token-hint slack-app-token-error"
                   onblur="validateSlackToken('slack-app-token', 'xapp-', 'slack-app-token-error')">
            <button class="reveal-btn" type="button"
                    onclick="toggleReveal('slack-app-token', this)"
                    aria-label="Reveal App Token">show</button>
          </div>
          <div class="field-hint" id="slack-app-token-hint">
            Slack → your app → Basic Information → App-Level Tokens → the one with connections:write (starts with xapp-)
          </div>
          <div class="field-error" id="slack-app-token-error" role="alert" aria-live="polite"></div>
        </div>

        <div class="btn-row" style="margin-top:21px">
          <button class="btn btn-primary btn-primary-lg" id="connect-slack-btn"
                  onclick="connectSlack()"
                  disabled aria-disabled="true">
            Connect Slack →
          </button>
        </div>

        <hr class="divider">

        <div class="help-block">
          <p>where to find these:</p>
          <ol class="step-list" style="margin-top:8px">
            <li><span class="step-num">1</span><span>go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">api.slack.com/apps</a> → your tino app</span></li>
            <li><span class="step-num">2</span><span>OAuth &amp; Permissions → Bot User OAuth Token (xoxb-)</span></li>
            <li><span class="step-num">3</span><span>Basic Information → App-Level Tokens → the one with connections:write (xapp-)</span></li>
          </ol>
          <p style="margin-top:12px">need help creating a Slack app? <a href="https://api.slack.com/start/quickstart" target="_blank" rel="noopener noreferrer">step-by-step guide →</a></p>
        </div>
      </div>
    </div>

    <!-- ── Screen 2: Basics ─────────────────────────────────────────────── -->
    <div id="screen-basics" class="screen">
      <div class="logo-block">
        <img src="/assets/tino-logo.png" alt="tino" class="logo-img">
        <span class="logo-wordmark">tino</span>
      </div>
      <div class="setup-screen">
        <div class="success-banner" id="basics-slack-banner">
          <span class="success-banner-icon">✓</span>
          <span id="basics-slack-workspace">connected to Slack</span>
        </div>

        <h1 class="setup-heading">now let's set up the basics.</h1>
        <p class="setup-lead" style="margin-bottom:21px">
          Two settings and you're ready to go.
        </p>

        <div class="field-group">
          <label class="field-label" for="bedrock-model-id">Bedrock Model ID</label>
          <input class="field-input" type="text" id="bedrock-model-id"
                 value="global.anthropic.claude-sonnet-4-6"
                 autocomplete="off"
                 aria-describedby="bedrock-model-hint bedrock-model-error">
          <div class="field-hint" id="bedrock-model-hint">
            The AI model tino uses. The default works for most setups.
            (<span style="font-family:var(--mono);font-size:0.786rem">bedrock.modelId</span>)
          </div>
          <div class="field-error" id="bedrock-model-error" role="alert" aria-live="polite"></div>
        </div>

        <div class="field-group">
          <label class="field-label" for="admin-user-id">Admin Slack User ID</label>
          <input class="field-input" type="text" id="admin-user-id"
                 placeholder="U05S91V7LJF"
                 autocomplete="off"
                 aria-describedby="admin-user-hint admin-user-error">
          <div class="field-hint" id="admin-user-hint">
            Your Slack user ID. Only you can DM tino.
            Find it: Slack → your profile → ⋯ → Copy member ID.
            (<span style="font-family:var(--mono);font-size:0.786rem">slack.adminUserId</span>)
          </div>
          <div class="field-error" id="admin-user-error" role="alert" aria-live="polite"></div>
        </div>

        <div class="btn-row" style="margin-top:21px">
          <button class="btn btn-primary btn-primary-lg" id="save-basics-btn"
                  onclick="saveBasics()">
            Save &amp; Continue →
          </button>
        </div>

        <hr class="divider">

        <button class="btn-ghost" onclick="skipToConsole()">
          skip for now → go to full console
        </button>
      </div>
    </div>

    <!-- ── Screen 3: Full console ───────────────────────────────────────── -->
    <div id="screen-console" class="screen">

      <!-- Header -->
      <header class="header">
        <img src="/assets/tino-logo.png" alt="tino" class="header-logo">
        <div>
          <div class="header-wordmark">tino</div>
          <div class="header-sub">configuration console</div>
        </div>
        <div class="header-status" id="header-status">
          <span class="status-dot" id="status-dot"></span>
          <span id="status-text">loading…</span>
        </div>
      </header>

      <!-- Capabilities grid -->
      <div class="section-label">Capabilities</div>
      <div class="cap-grid" id="cap-grid">
        <div class="empty" style="grid-column:1/-1;padding:16px">Loading…</div>
      </div>

      <!-- Raw config (collapsible) -->
      <div class="raw-section" id="raw-section">
        <button class="raw-toggle" onclick="toggleRaw()" aria-expanded="false" aria-controls="raw-body-wrap">
          <svg class="raw-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="4,2 8,6 4,10"/>
          </svg>
          Raw config entries
        </button>
        <div class="raw-body-wrap" id="raw-body-wrap">
          <div class="raw-body-inner">
            <div class="raw-body">
              <table class="config-table" id="config-table">
                <thead>
                  <tr>
                    <th class="col-key">Key</th>
                    <th class="col-val">Value</th>
                    <th class="col-ts">Updated</th>
                    <th class="col-act"></th>
                  </tr>
                </thead>
                <tbody id="config-body">
                  <tr><td colspan="4" class="empty">Loading…</td></tr>
                </tbody>
              </table>

              <div class="section-label" style="margin-top:16px">Add / update entry</div>
              <div class="add-form">
                <div class="add-form-fields">
                  <div class="field-group">
                    <label class="field-label field-label-mono" for="new-key">Key</label>
                    <input class="field-input" type="text" id="new-key"
                           placeholder="capability.github"
                           aria-describedby="new-key-hint new-key-error">
                    <div class="field-hint" id="new-key-hint">e.g. capability.github</div>
                    <div class="field-error" id="new-key-error" role="alert" aria-live="polite"></div>
                  </div>
                  <div class="field-group">
                    <label class="field-label field-label-mono" for="new-value">Value <span style="font-weight:400;color:var(--text-dim)">(JSON)</span></label>
                    <input class="field-input" type="text" id="new-value"
                           placeholder='"value" or true or 42'
                           aria-describedby="new-value-hint new-value-error">
                    <div class="field-hint" id="new-value-hint">Must be valid JSON</div>
                    <div class="field-error" id="new-value-error" role="alert" aria-live="polite"></div>
                  </div>
                </div>
                <div>
                  <button class="btn btn-primary" id="add-btn" onclick="saveEntry()"
                          disabled aria-disabled="true" title="No changes to save">Save entry</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Compliance (collapsed by default) -->
      <div class="compliance-section" id="compliance-section">
        <button class="compliance-toggle" onclick="toggleCompliance()" aria-expanded="false" aria-controls="compliance-body-wrap">
          <svg class="compliance-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="4,2 8,6 4,10"/>
          </svg>
          Compliance
        </button>
        <div class="compliance-body-wrap" id="compliance-body-wrap">
          <div class="compliance-body-inner">
            <div>
              <div class="compliance-loading" id="compliance-loading">Loading…</div>
              <div id="compliance-content" style="display:none">

                <div class="detail-label" style="margin-bottom:8px">BAA Status</div>
                <table class="compliance-table" id="baa-table">
                  <thead><tr>
                    <th class="col-service">Service</th>
                    <th class="col-status">Status</th>
                  </tr></thead>
                  <tbody id="baa-body"></tbody>
                </table>

                <div class="detail-label" style="margin-top:16px;margin-bottom:8px">Encryption</div>
                <table class="compliance-table" id="enc-table">
                  <thead><tr>
                    <th class="col-service">Resource</th>
                    <th class="col-status">Status</th>
                  </tr></thead>
                  <tbody id="enc-body"></tbody>
                </table>

                <div class="detail-label" style="margin-top:16px;margin-bottom:8px">Audit Log Health</div>
                <table class="compliance-table" id="audit-table">
                  <thead><tr>
                    <th class="col-service">Metric</th>
                    <th class="col-detail">Value</th>
                  </tr></thead>
                  <tbody id="audit-body"></tbody>
                </table>

                <div class="detail-label" style="margin-top:16px;margin-bottom:8px">Data Retention</div>
                <table class="compliance-table" id="retention-table">
                  <thead><tr>
                    <th class="col-service">Policy</th>
                    <th class="col-detail">Value</th>
                  </tr></thead>
                  <tbody id="retention-body"></tbody>
                </table>

              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Health footer -->
      <footer class="health-footer" id="health-footer">
        <span class="health-uptime" id="health-uptime">—</span>
        <span class="health-tools" id="health-tools">—</span>
      </footer>

    </div><!-- /screen-console -->

  </div><!-- /page -->

  <!-- Toast -->
  <div id="toast" role="status" aria-live="polite">
    <span id="toast-text"></span>
    <button id="toast-undo" style="display:none" type="button"></button>
  </div>

  <script>
    'use strict';

    // ── State ──────────────────────────────────────────────────────────────
    let configData = [];
    let capData = [];
    let openCapId = null;

    // ── Dirty-state tracking ───────────────────────────────────────────────
    const initialValues = {};

    function trackDirty(sectionId, saveButtonId, inputs) {
      const btn = document.getElementById(saveButtonId);
      if (!btn) return;
      const initial = {};
      inputs.forEach(inp => { initial[inp.id] = inp.value; });
      initialValues[sectionId] = initial;
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.title = 'No changes to save';
      inputs.forEach(inp => {
        inp.addEventListener('input', () => {
          const isDirty = [...inputs].some(i => i.value !== initialValues[sectionId][i.id]);
          btn.disabled = !isDirty;
          btn.setAttribute('aria-disabled', String(!isDirty));
          if (isDirty) { btn.removeAttribute('title'); } else { btn.title = 'No changes to save'; }
        });
      });
    }

    function resetDirty(sectionId, saveButtonId, inputs) {
      const btn = document.getElementById(saveButtonId);
      if (!btn) return;
      const initial = {};
      inputs.forEach(inp => { initial[inp.id] = inp.value; });
      initialValues[sectionId] = initial;
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.title = 'No changes to save';
    }

    // ── Capability metadata ────────────────────────────────────────────────
    const CAP_META = {
      slack:      { icon: '💬', name: 'Slack',      desc: 'Search messages, read DMs, and browse channels.' },
      github:     { icon: '🔍', name: 'GitHub',     desc: 'Search code, read files, and check PR status.' },
      calendar:   { icon: '📅', name: 'Calendar',   desc: 'Read and create Google Calendar events.' },
      gmail:      { icon: '📧', name: 'Gmail',      desc: 'Read and send email via Gmail.' },
      linear:     { icon: '📋', name: 'Linear',     desc: 'Browse issues and manage project work.' },
      cloudwatch: { icon: '📊', name: 'CloudWatch', desc: 'Query AWS CloudWatch logs and metrics.' },
    };

    // Display order: Slack first, then most useful, then rest
    const CAP_ORDER = ['slack', 'github', 'calendar', 'gmail', 'linear', 'cloudwatch'];

    const CAP_CRED_KEYS = {
      github:     ['token'],
      linear:     ['token'],
      slack:      ['userToken'],
      gmail:      ['clientId', 'clientSecret', 'refreshToken'],
      calendar:   ['clientId', 'clientSecret', 'refreshToken'],
      cloudwatch: [],
    };

    const CAP_CRED_HINTS = {
      github:   { token: { placeholder: 'ghp_…', hint: 'Starts with ghp_' } },
      linear:   { token: { placeholder: 'lin_api_…', hint: 'Starts with lin_api_' } },
      slack:    { userToken: { placeholder: 'xoxp-… or xoxb-…', hint: 'Starts with xoxp-, xoxb-, or xapp-' } },
      gmail:    {
        clientId:     { placeholder: '…apps.googleusercontent.com', hint: 'OAuth 2.0 client ID from Google Cloud Console' },
        clientSecret: { placeholder: 'GOCSPX-…', hint: 'OAuth 2.0 client secret' },
        refreshToken: { placeholder: '1//…', hint: 'OAuth 2.0 refresh token' },
      },
      calendar: {
        clientId:     { placeholder: '…apps.googleusercontent.com', hint: 'OAuth 2.0 client ID from Google Cloud Console' },
        clientSecret: { placeholder: 'GOCSPX-…', hint: 'OAuth 2.0 client secret' },
        refreshToken: { placeholder: '1//…', hint: 'OAuth 2.0 refresh token' },
      },
      cloudwatch: {},
    };

    const CAP_EMPTY_STATE = {
      github: {
        msg: 'Paste your GitHub Personal Access Token to enable code search and PR management.',
        link: 'https://github.com/settings/tokens',
        linkText: 'Get one at github.com/settings/tokens',
      },
      linear: {
        msg: 'Add your Linear API key to enable issue tracking and project management.',
        link: 'https://linear.app/settings/api',
        linkText: 'Get one at linear.app/settings/api',
      },
      slack: {
        msg: 'Add your Slack user token to enable message search and channel access.',
        link: 'https://api.slack.com/apps',
        linkText: 'Create a Slack app at api.slack.com/apps',
      },
      gmail: {
        msg: 'Add your Gmail OAuth credentials to enable email reading and sending.',
        link: 'https://console.cloud.google.com/apis/credentials',
        linkText: 'Create credentials at Google Cloud Console',
      },
      calendar: {
        msg: 'Add your Google Calendar OAuth credentials to enable calendar access.',
        link: 'https://console.cloud.google.com/apis/credentials',
        linkText: 'Create credentials at Google Cloud Console',
      },
    };

    const CAP_SETTING_KEYS = {
      github:     ['repos', 'defaultRepo'],
      linear:     ['defaultTeamKey', 'autoPickupStates'],
      slack:      [],
      gmail:      [],
      calendar:   ['calendarId'],
      cloudwatch: ['logGroups', 'region'],
    };

    // ── Init: detect state and route to correct screen ─────────────────────
    async function init() {
      try {
        const entries = await fetch('/api/config').then(r => r.json());
        configData = entries;

        // Check for Slack connection
        const slackEntry = entries.find(e => e.key === 'capability.slack');
        let slackCfg = null;
        try { slackCfg = slackEntry ? JSON.parse(slackEntry.value) : null; } catch { /* ignore */ }
        const hasSlack = slackCfg && (slackCfg.credentials?.botToken || slackCfg.credentials?.userToken);

        // Check for bedrock model
        const hasModel = entries.some(e => e.key === 'bedrock.modelId');

        if (!hasSlack) {
          showScreen('welcome');
          initWelcomeScreen();
        } else if (!hasModel) {
          showScreen('basics');
          initBasicsScreen(slackCfg);
        } else {
          showScreen('console');
          await loadConsole();
        }
      } catch (e) {
        // If API is unreachable, show welcome screen as fallback
        showScreen('welcome');
        initWelcomeScreen();
        showToast('Could not reach tino API: ' + e.message, 'err');
      }
    }

    function showScreen(name) {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      const el = document.getElementById('screen-' + name);
      if (el) el.classList.add('active');
      // Update page title
      const titles = { welcome: 'tino — setup', basics: 'tino — basics', console: 'tino — configuration' };
      document.title = titles[name] || 'tino';
    }

    // ── Welcome screen ─────────────────────────────────────────────────────
    function initWelcomeScreen() {
      const botInput = document.getElementById('slack-bot-token');
      const appInput = document.getElementById('slack-app-token');
      const connectBtn = document.getElementById('connect-slack-btn');

      function updateConnectBtn() {
        const hasBot = botInput.value.trim().length > 0;
        const hasApp = appInput.value.trim().length > 0;
        const enabled = hasBot && hasApp;
        connectBtn.disabled = !enabled;
        connectBtn.setAttribute('aria-disabled', String(!enabled));
      }

      botInput.addEventListener('input', updateConnectBtn);
      appInput.addEventListener('input', updateConnectBtn);
    }

    async function connectSlack() {
      const botToken = document.getElementById('slack-bot-token').value.trim();
      const appToken = document.getElementById('slack-app-token').value.trim();

      // Validate both fields
      const botOk = validateSlackToken('slack-bot-token', 'xoxb-', 'slack-bot-token-error');
      const appOk = validateSlackToken('slack-app-token', 'xapp-', 'slack-app-token-error');
      if (!botOk || !appOk) return;

      const btn = document.getElementById('connect-slack-btn');
      btn.textContent = 'Connecting…';
      btn.classList.add('saving');

      try {
        // Save Slack capability config with both tokens
        const slackConfig = {
          enabled: true,
          credentials: {
            botToken: botToken,
            appToken: appToken,
            userToken: botToken, // userToken alias for capability module compatibility
          },
          settings: {},
          findWork: { enabled: false, intervalMinutes: 15 },
        };

        const res = await fetch('/api/capabilities/slack', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(slackConfig),
        });
        if (!res.ok) throw new Error(await res.text());

        btn.textContent = 'Connected ✓';
        btn.classList.remove('saving');
        btn.classList.add('saved');

        // Brief success pause, then advance to basics screen
        setTimeout(() => {
          showScreen('basics');
          initBasicsScreen(slackConfig);
        }, 800);

      } catch (e) {
        btn.textContent = 'Connect Slack →';
        btn.classList.remove('saving');
        btn.disabled = false;
        btn.removeAttribute('aria-disabled');
        showToast('Failed to save Slack config: ' + e.message, 'err');
      }
    }

    // ── Basics screen ──────────────────────────────────────────────────────
    function initBasicsScreen(slackCfg) {
      // Show workspace name if we can derive it (we can't without an API call, so show generic)
      const banner = document.getElementById('basics-slack-workspace');
      if (banner) banner.textContent = 'connected to Slack';
    }

    async function saveBasics() {
      const modelEl = document.getElementById('bedrock-model-id');
      const adminEl = document.getElementById('admin-user-id');
      const btn = document.getElementById('save-basics-btn');

      const model = modelEl.value.trim();
      const adminId = adminEl.value.trim();

      // Validate
      let hasError = false;
      if (!model) {
        setFieldInvalid(modelEl, 'bedrock-model-error', 'Model ID is required.');
        hasError = true;
      } else {
        setFieldValid(modelEl, 'bedrock-model-error');
      }
      if (!adminId) {
        setFieldInvalid(adminEl, 'admin-user-error', 'Admin user ID is required. Find it in Slack: your profile → ⋯ → Copy member ID.');
        hasError = true;
      } else if (!adminId.match(/^U[A-Z0-9]+$/)) {
        setFieldInvalid(adminEl, 'admin-user-error', 'Slack user IDs start with U followed by uppercase letters and numbers (e.g. U05S91V7LJF).');
        hasError = true;
      } else {
        setFieldValid(adminEl, 'admin-user-error');
      }
      if (hasError) return;

      btn.textContent = 'Saving…';
      btn.classList.add('saving');

      try {
        // Save bedrock model ID
        const modelRes = await fetch('/api/config/' + encodeURIComponent('bedrock.modelId'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: model }),
        });
        if (!modelRes.ok) throw new Error(await modelRes.text());

        // Save admin user ID
        const adminRes = await fetch('/api/config/' + encodeURIComponent('slack.adminUserId'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: adminId }),
        });
        if (!adminRes.ok) throw new Error(await adminRes.text());

        btn.textContent = 'Saved ✓';
        btn.classList.remove('saving');
        btn.classList.add('saved');

        setTimeout(async () => {
          showScreen('console');
          await loadConsole();
        }, 600);

      } catch (e) {
        btn.textContent = 'Save & Continue →';
        btn.classList.remove('saving');
        showToast('Save failed: ' + e.message, 'err');
      }
    }

    function skipToConsole() {
      showScreen('console');
      void loadConsole();
    }

    // ── Console screen ─────────────────────────────────────────────────────
    async function loadConsole() {
      await Promise.all([loadCapabilities(), loadConfig(), loadHealth(), loadCompliance()]);
      // Wire dirty tracking for the raw config "Save entry" button
      const addBtn = document.getElementById('add-btn');
      const newKeyEl = document.getElementById('new-key');
      const newValEl = document.getElementById('new-value');
      function updateAddBtn() {
        const hasContent = newKeyEl.value.trim().length > 0 && newValEl.value.trim().length > 0;
        addBtn.disabled = !hasContent;
        addBtn.setAttribute('aria-disabled', String(!hasContent));
        if (hasContent) { addBtn.removeAttribute('title'); } else { addBtn.title = 'No changes to save'; }
      }
      newKeyEl.addEventListener('input', updateAddBtn);
      newValEl.addEventListener('input', updateAddBtn);
    }

    // ── Capabilities ───────────────────────────────────────────────────────
    async function loadCapabilities() {
      try {
        const res = await fetch('/api/capabilities');
        capData = await res.json();
        renderCapabilities();
      } catch (e) {
        showToast('Failed to load capabilities: ' + e.message, 'err');
      }
    }

    function capState(id) {
      const entry = capData.find(c => c.id === id);
      const cfg = entry?.config;
      const enabled = cfg?.enabled ?? false;
      const creds = cfg?.credentials ?? {};
      const credKeys = CAP_CRED_KEYS[id] ?? [];
      const credSet = credKeys.length === 0 || credKeys.every(k => creds[k]);
      return { enabled, credSet, credKeys, cfg };
    }

    function renderCapabilities() {
      const grid = document.getElementById('cap-grid');

      grid.innerHTML = CAP_ORDER.map(id => {
        const meta = CAP_META[id] ?? { icon: '⚙️', name: id, desc: '' };
        const { enabled, credSet, credKeys } = capState(id);

        let stateClass = 'state-disabled';
        if (enabled && credSet) stateClass = 'state-ok';
        else if (enabled && !credSet) stateClass = 'state-warn';

        const isConnected = enabled && credSet;
        const isOpen = openCapId === id;

        const statusHtml = isConnected
          ? \`<span class="status-connected">✓ connected</span>\`
          : \`<button class="btn btn-primary btn-setup" onclick="event.stopPropagation();openCapCard('\${id}')">Set up →</button>\`;

        return \`<div class="cap-card \${stateClass}\${isOpen ? ' open' : ''}" id="cap-card-\${id}">
          <div class="cap-card-header" onclick="toggleCapCard('\${id}')" role="button" tabindex="0"
               aria-expanded="\${isOpen}" aria-controls="cap-detail-\${id}"
               onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleCapCard('\${id}')}">
            <span class="cap-card-icon" aria-hidden="true">\${meta.icon}</span>
            <div class="cap-card-meta">
              <div class="cap-card-name">\${escHtml(meta.name)}</div>
              <div class="cap-card-desc">\${escHtml(meta.desc)}</div>
            </div>
            <div class="cap-card-status">
              \${statusHtml}
              <svg class="cap-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                   stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="5,3 11,8 5,13"/>
              </svg>
            </div>
          </div>
          <div class="cap-detail-wrap" id="cap-detail-wrap-\${id}">
            <div class="cap-detail-inner">
              <div class="cap-detail" id="cap-detail-\${id}">
                \${renderCapDetailContent(id)}
              </div>
            </div>
          </div>
        </div>\`;
      }).join('');
    }

    function renderCapDetailContent(id) {
      const entry = capData.find(c => c.id === id);
      const cfg = entry?.config ?? { enabled: false, credentials: {}, settings: {}, findWork: { enabled: false, intervalMinutes: 15 } };
      const credKeys = CAP_CRED_KEYS[id] ?? [];
      const settingKeys = CAP_SETTING_KEYS[id] ?? [];
      const fwEnabled = cfg.findWork?.enabled ?? false;
      const fwInterval = cfg.findWork?.intervalMinutes ?? 15;
      const credHints = CAP_CRED_HINTS[id] ?? {};
      const emptyState = CAP_EMPTY_STATE[id];
      const enabled = cfg.enabled ?? false;

      // Enable/disable toggle
      const toggleHtml = \`<div class="detail-section">
        <div class="detail-label">Status</div>
        <div class="toggle-wrap">
          <label class="toggle" title="\${enabled ? 'Disable' : 'Enable'} \${escHtml(CAP_META[id]?.name ?? id)}">
            <input type="checkbox" \${enabled ? 'checked' : ''}
                   onchange="toggleCapability('\${id}', this.checked)"
                   aria-label="Enable \${escHtml(CAP_META[id]?.name ?? id)}"
                   aria-checked="\${enabled}">
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
          <span style="font-size:0.857rem;color:var(--text-sec)">\${enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
      </div>\`;

      // Credentials section
      let credContent = '';
      if (credKeys.length === 0) {
        credContent = '<p class="empty">No credentials required.</p>';
      } else {
        const creds = cfg.credentials ?? {};
        const anySet = credKeys.some(k => creds[k]);

        if (!anySet && emptyState) {
          credContent = \`<div class="empty-state">
            <p class="empty-state-msg">\${escHtml(emptyState.msg)}</p>
            <a class="empty-state-link" href="\${escHtml(emptyState.link)}" target="_blank" rel="noopener noreferrer">\${escHtml(emptyState.linkText)}</a>
          </div>\`;
        }

        credContent += credKeys.map(k => {
          const val = creds[k] ?? '';
          const hint = credHints[k] ?? {};
          const inputId = 'cred-' + id + '-' + k;
          const hintId = inputId + '-hint';
          const errId = inputId + '-error';
          return \`<div class="field-group">
            <label class="field-label field-label-mono" for="\${inputId}">\${escHtml(k)}</label>
            <div class="field-input-wrap">
              <input class="field-input" type="password" id="\${inputId}"
                     value="\${escHtml(val)}"
                     placeholder="\${escHtml(hint.placeholder ?? '')}"
                     aria-describedby="\${hintId} \${errId}"
                     onblur="validateCredField('\${id}', '\${k}', this)">
              <button class="reveal-btn" type="button"
                      onclick="toggleReveal('\${inputId}', this)"
                      aria-label="Reveal \${escHtml(k)}">show</button>
            </div>
            \${hint.hint ? \`<div class="field-hint" id="\${hintId}">\${escHtml(hint.hint)}</div>\` : \`<div id="\${hintId}"></div>\`}
            <div class="field-error" id="\${errId}" role="alert" aria-live="polite"></div>
          </div>\`;
        }).join('');

        credContent += \`<div class="btn-row">
          <button class="btn btn-primary" id="save-cred-\${id}"
                  onclick="saveCredentials('\${id}')"
                  disabled aria-disabled="true" title="No changes to save">Save credentials</button>
        </div>\`;
      }

      // Settings section
      let settingContent = '';
      if (settingKeys.length === 0) {
        settingContent = '<p class="empty">No settings.</p>';
      } else {
        settingContent = settingKeys.map(k => {
          const val = cfg.settings?.[k];
          const display = val !== undefined ? JSON.stringify(val) : '';
          const inputId = 'setting-' + id + '-' + k;
          const hintId = inputId + '-hint';
          const errId = inputId + '-error';
          return \`<div class="field-group">
            <label class="field-label field-label-mono" for="\${inputId}">\${escHtml(k)}</label>
            <input class="field-input" type="text" id="\${inputId}"
                   value="\${escHtml(display)}"
                   placeholder="JSON value"
                   aria-describedby="\${hintId} \${errId}"
                   onblur="validateJsonField(this, '\${errId}')">
            <div class="field-hint" id="\${hintId}">JSON value (string, number, array, or object)</div>
            <div class="field-error" id="\${errId}" role="alert" aria-live="polite"></div>
          </div>\`;
        }).join('');
        settingContent += \`<div class="btn-row">
          <button class="btn btn-primary" id="save-setting-\${id}"
                  onclick="saveSettings('\${id}')"
                  disabled aria-disabled="true" title="No changes to save">Save settings</button>
        </div>\`;
      }

      // findWork section
      const fwIntervalInputId = 'fw-interval-' + id;
      const fwIntervalErrId = fwIntervalInputId + '-error';

      return \`
        \${toggleHtml}
        <div class="detail-section">
          <div class="detail-label">Credentials</div>
          \${credContent}
        </div>
        <div class="detail-section">
          <div class="detail-label">Settings</div>
          \${settingContent}
        </div>
        <div class="detail-section">
          <div class="detail-label">Find work</div>
          <div class="fw-row">
            <div class="fw-toggle-group">
              <label class="toggle" title="Enable autonomous scanning">
                <input type="checkbox" id="fw-enabled-\${id}" \${fwEnabled ? 'checked' : ''}
                       aria-label="Enable find work for \${escHtml(CAP_META[id]?.name ?? id)}"
                       aria-checked="\${fwEnabled}">
                <span class="toggle-track"></span>
                <span class="toggle-thumb"></span>
              </label>
              <span class="fw-label">Autonomous scanning</span>
            </div>
            <div class="fw-interval-group">
              <label class="fw-interval-label" for="\${fwIntervalInputId}">Interval</label>
              <div class="fw-interval-wrap">
                every
                <input class="fw-interval-input" type="number" id="\${fwIntervalInputId}"
                       value="\${fwInterval}" min="1" max="1440"
                       aria-label="Find work interval in minutes"
                       aria-describedby="\${fwIntervalErrId}"
                       onblur="validateIntervalField(this, '\${fwIntervalErrId}')">
                min
              </div>
              <div class="field-error" id="\${fwIntervalErrId}" role="alert" aria-live="polite"></div>
            </div>
          </div>
          <div class="btn-row">
            <button class="btn btn-primary" id="save-fw-\${id}"
                    onclick="saveFindWork('\${id}')"
                    disabled aria-disabled="true" title="No changes to save">Save find work</button>
          </div>
        </div>
      \`;
    }

    function initCapDirtyTracking(id) {
      const credKeys = CAP_CRED_KEYS[id] ?? [];
      const settingKeys = CAP_SETTING_KEYS[id] ?? [];

      if (credKeys.length > 0) {
        const credInputs = credKeys.map(k => document.getElementById('cred-' + id + '-' + k)).filter(Boolean);
        if (credInputs.length > 0) trackDirty('cred-' + id, 'save-cred-' + id, credInputs);
      }
      if (settingKeys.length > 0) {
        const settingInputs = settingKeys.map(k => document.getElementById('setting-' + id + '-' + k)).filter(Boolean);
        if (settingInputs.length > 0) trackDirty('setting-' + id, 'save-setting-' + id, settingInputs);
      }
      const fwIntervalEl = document.getElementById('fw-interval-' + id);
      if (fwIntervalEl) trackDirty('fw-' + id, 'save-fw-' + id, [fwIntervalEl]);
    }

    function openCapCard(id) {
      const card = document.getElementById('cap-card-' + id);
      if (!card || card.classList.contains('open')) return;
      card.classList.add('open');
      card.querySelector('.cap-card-header').setAttribute('aria-expanded', 'true');
      openCapId = id;
      initCapDirtyTracking(id);
      setTimeout(() => {
        const detail = document.getElementById('cap-detail-' + id);
        if (!detail) return;
        const first = detail.querySelector('input, button, a[href]');
        if (first) first.focus();
      }, 230);
    }

    function toggleCapCard(id) {
      const card = document.getElementById('cap-card-' + id);
      if (!card) return;
      const isOpen = card.classList.contains('open');
      if (isOpen) {
        card.classList.remove('open');
        card.querySelector('.cap-card-header').setAttribute('aria-expanded', 'false');
        openCapId = null;
      } else {
        card.classList.add('open');
        card.querySelector('.cap-card-header').setAttribute('aria-expanded', 'true');
        openCapId = id;
        initCapDirtyTracking(id);
        setTimeout(() => {
          const detail = document.getElementById('cap-detail-' + id);
          if (!detail) return;
          const first = detail.querySelector('input, button, a[href]');
          if (first) first.focus();
        }, 230);
      }
    }

    // ── Capability mutations ───────────────────────────────────────────────
    async function toggleCapability(id, enabled) {
      const entry = capData.find(c => c.id === id);
      const cfg = JSON.parse(JSON.stringify(entry?.config ?? { enabled: false, credentials: {}, settings: {} }));
      cfg.enabled = enabled;
      const toggle = document.querySelector('#cap-card-' + id + ' input[type="checkbox"][aria-label^="Enable"]');
      if (toggle) toggle.setAttribute('aria-checked', String(enabled));
      await putCapability(id, cfg, null);
    }

    async function saveCredentials(id) {
      const entry = capData.find(c => c.id === id);
      const cfg = JSON.parse(JSON.stringify(entry?.config ?? { enabled: false, credentials: {}, settings: {} }));
      const credKeys = CAP_CRED_KEYS[id] ?? [];
      cfg.credentials = cfg.credentials ?? {};
      let hasError = false;
      for (const k of credKeys) {
        const el = document.getElementById('cred-' + id + '-' + k);
        if (el) {
          const valid = validateCredField(id, k, el);
          if (!valid) hasError = true;
          cfg.credentials[k] = el.value;
        }
      }
      if (hasError) return;
      await putCapability(id, cfg, 'save-cred-' + id);
    }

    async function saveSettings(id) {
      const entry = capData.find(c => c.id === id);
      const cfg = JSON.parse(JSON.stringify(entry?.config ?? { enabled: false, credentials: {}, settings: {} }));
      const settingKeys = CAP_SETTING_KEYS[id] ?? [];
      cfg.settings = cfg.settings ?? {};
      let hasError = false;
      for (const k of settingKeys) {
        const el = document.getElementById('setting-' + id + '-' + k);
        if (!el) continue;
        const errId = 'setting-' + id + '-' + k + '-error';
        const valid = validateJsonField(el, errId);
        if (!valid) { hasError = true; continue; }
        const raw = el.value.trim();
        if (!raw) { delete cfg.settings[k]; continue; }
        cfg.settings[k] = JSON.parse(raw);
      }
      if (hasError) return;
      await putCapability(id, cfg, 'save-setting-' + id);
    }

    async function saveFindWork(id) {
      const entry = capData.find(c => c.id === id);
      const cfg = JSON.parse(JSON.stringify(entry?.config ?? { enabled: false, credentials: {}, settings: {} }));
      const fwEnabled = document.getElementById('fw-enabled-' + id)?.checked ?? false;
      const intervalEl = document.getElementById('fw-interval-' + id);
      const errId = 'fw-interval-' + id + '-error';
      if (intervalEl && !validateIntervalField(intervalEl, errId)) return;
      const fwInterval = parseInt(intervalEl?.value ?? '15', 10);
      cfg.findWork = { enabled: fwEnabled, intervalMinutes: isNaN(fwInterval) ? 15 : fwInterval };
      await putCapability(id, cfg, 'save-fw-' + id);
    }

    async function putCapability(id, cfg, btnId) {
      const btn = btnId ? document.getElementById(btnId) : null;
      if (btn) {
        btn.textContent = 'Saving…';
        btn.classList.add('saving');
        btn.setAttribute('aria-disabled', 'true');
      }
      try {
        const res = await fetch('/api/capabilities/' + encodeURIComponent(id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cfg),
        });
        if (!res.ok) throw new Error(await res.text());
        if (btn) {
          btn.textContent = 'Saved ✓';
          btn.classList.remove('saving');
          btn.classList.add('saved');
          btn.removeAttribute('aria-disabled');
          setTimeout(() => {
            btn.textContent = btn.id.startsWith('save-cred') ? 'Save credentials'
              : btn.id.startsWith('save-setting') ? 'Save settings'
              : btn.id.startsWith('save-fw') ? 'Save find work'
              : 'Save entry';
            btn.classList.remove('saved');
          }, 2000);
        }
        showToast((CAP_META[id]?.name ?? id) + ' saved', 'ok');
        await loadCapabilities();
        if (openCapId === id) {
          const card = document.getElementById('cap-card-' + id);
          if (card) {
            card.classList.add('open');
            initCapDirtyTracking(id);
          }
        }
      } catch (e) {
        if (btn) {
          btn.textContent = 'Save failed — retry';
          btn.classList.remove('saving');
          btn.classList.add('save-error');
          btn.removeAttribute('aria-disabled');
          setTimeout(() => {
            btn.textContent = btn.id.startsWith('save-cred') ? 'Save credentials'
              : btn.id.startsWith('save-setting') ? 'Save settings'
              : btn.id.startsWith('save-fw') ? 'Save find work'
              : 'Save entry';
            btn.classList.remove('save-error');
          }, 3000);
        }
        showToast('Save failed: ' + e.message, 'err');
      }
    }

    // ── Reveal credential ──────────────────────────────────────────────────
    function toggleReveal(inputId, btn) {
      const input = document.getElementById(inputId);
      if (!input) return;
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = 'hide';
        btn.setAttribute('aria-label', btn.getAttribute('aria-label')?.replace('Reveal', 'Hide') ?? 'Hide');
      } else {
        input.type = 'password';
        btn.textContent = 'show';
        btn.setAttribute('aria-label', btn.getAttribute('aria-label')?.replace('Hide', 'Reveal') ?? 'Reveal');
      }
    }

    // ── Validation ─────────────────────────────────────────────────────────
    function showFieldError(errId, message) {
      const el = document.getElementById(errId);
      if (!el) return;
      el.textContent = message;
      el.classList.add('visible');
    }

    function clearFieldError(errId) {
      const el = document.getElementById(errId);
      if (!el) return;
      el.textContent = '';
      el.classList.remove('visible');
    }

    function setFieldInvalid(input, errId, message) {
      input.setAttribute('aria-invalid', 'true');
      showFieldError(errId, message);
    }

    function setFieldValid(input, errId) {
      input.removeAttribute('aria-invalid');
      clearFieldError(errId);
    }

    // Validate a Slack token field by expected prefix
    function validateSlackToken(inputId, expectedPrefix, errId) {
      const input = document.getElementById(inputId);
      if (!input) return false;
      const val = input.value.trim();
      if (!val) {
        setFieldInvalid(input, errId, 'Token is required.');
        return false;
      }
      if (!val.startsWith(expectedPrefix)) {
        setFieldInvalid(input, errId,
          'Token format looks wrong. Expected a token starting with ' + expectedPrefix +
          '. Check that you copied the full token.');
        return false;
      }
      setFieldValid(input, errId);
      return true;
    }

    const CRED_VALIDATORS = {
      github: {
        token: (v) => {
          if (!v) return 'Token is required. Paste your GitHub Personal Access Token.';
          if (!v.startsWith('ghp_') && !v.startsWith('github_pat_') && !v.startsWith('gho_'))
            return 'Token format looks wrong. GitHub tokens start with ghp_, github_pat_, or gho_. Check that you copied the full token.';
          return null;
        },
      },
      linear: {
        token: (v) => {
          if (!v) return 'Token is required. Paste your Linear API key.';
          if (!v.startsWith('lin_api_'))
            return 'Token format looks wrong. Linear API keys start with lin_api_. Check that you copied the full key.';
          return null;
        },
      },
      slack: {
        userToken: (v) => {
          if (!v) return 'Token is required. Paste your Slack user token.';
          if (!v.startsWith('xoxp-') && !v.startsWith('xoxb-') && !v.startsWith('xapp-'))
            return 'Token format looks wrong. Slack tokens start with xoxp-, xoxb-, or xapp-. Check that you copied the full token.';
          return null;
        },
      },
    };

    function validateCredField(capId, credKey, input) {
      const errId = 'cred-' + capId + '-' + credKey + '-error';
      const validator = CRED_VALIDATORS[capId]?.[credKey];
      if (!validator) { setFieldValid(input, errId); return true; }
      const error = validator(input.value.trim());
      if (error) { setFieldInvalid(input, errId, error); return false; }
      setFieldValid(input, errId);
      return true;
    }

    function validateJsonField(input, errId) {
      const raw = input.value.trim();
      if (!raw) { setFieldValid(input, errId); return true; }
      try {
        JSON.parse(raw);
        setFieldValid(input, errId);
        return true;
      } catch {
        setFieldInvalid(input, errId, 'Value must be valid JSON. Check for missing quotes, brackets, or commas.');
        return false;
      }
    }

    function validateIntervalField(input, errId) {
      const val = parseInt(input.value, 10);
      if (isNaN(val) || val < 1) {
        setFieldInvalid(input, errId, 'Interval must be a whole number of minutes, minimum 1.');
        return false;
      }
      if (val > 1440) {
        setFieldInvalid(input, errId, 'Interval cannot exceed 1440 minutes (24 hours).');
        return false;
      }
      setFieldValid(input, errId);
      return true;
    }

    // ── Raw config ─────────────────────────────────────────────────────────
    async function loadConfig() {
      try {
        const res = await fetch('/api/config');
        configData = await res.json();
        renderConfig();
      } catch (e) {
        showToast('Failed to load config: ' + e.message, 'err');
      }
    }

    function renderConfig() {
      const tbody = document.getElementById('config-body');
      if (!configData.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty">No entries yet.</td></tr>';
        return;
      }
      tbody.innerHTML = configData.map(entry => {
        const ts = new Date(entry.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const safeKey = escHtml(entry.key);
        const safeVal = escHtml(entry.value);
        return \`<tr>
          <td class="col-key">\${safeKey}</td>
          <td class="col-val">\${safeVal}</td>
          <td class="col-ts">\${ts}</td>
          <td class="col-act">
            <button class="btn" onclick="editEntry('\${safeKey}')">Edit</button>
            <button class="btn btn-danger" onclick="initiateDelete(event, '\${safeKey}', this)">Delete</button>
            <div class="delete-confirm" id="del-confirm-\${safeKey}" role="group" aria-label="Confirm delete \${safeKey}">
              <span class="delete-confirm-text">Delete?</span>
              <button class="delete-confirm-yes" onclick="confirmDelete('\${safeKey}')">Yes</button>
              <button class="delete-confirm-no" onclick="cancelDelete('\${safeKey}')">No</button>
            </div>
          </td>
        </tr>\`;
      }).join('');
    }

    let pendingDeleteKey = null;
    let pendingDeleteTimer = null;

    function initiateDelete(event, key, btn) {
      event.stopPropagation();
      document.querySelectorAll('.delete-confirm.visible').forEach(el => el.classList.remove('visible'));
      const confirm = document.getElementById('del-confirm-' + key);
      if (!confirm) return;
      confirm.classList.add('visible');
      const yesBtn = confirm.querySelector('.delete-confirm-yes');
      if (yesBtn) yesBtn.focus();
    }

    function cancelDelete(key) {
      const confirm = document.getElementById('del-confirm-' + key);
      if (confirm) confirm.classList.remove('visible');
    }

    async function confirmDelete(key) {
      const confirm = document.getElementById('del-confirm-' + key);
      if (confirm) confirm.classList.remove('visible');
      const deleted = configData.find(e => e.key === key);
      configData = configData.filter(e => e.key !== key);
      renderConfig();
      showToast('Deleted ' + key, 'ok', 'Undo', async () => {
        if (deleted) {
          try {
            await fetch('/api/config/' + encodeURIComponent(key), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ value: JSON.parse(deleted.value) }),
            });
            await loadConfig();
            showToast('Restored ' + key, 'ok');
          } catch (e) {
            showToast('Restore failed: ' + e.message, 'err');
          }
        }
      });
      clearTimeout(pendingDeleteTimer);
      pendingDeleteKey = key;
      pendingDeleteTimer = setTimeout(async () => {
        if (pendingDeleteKey !== key) return;
        try {
          const res = await fetch('/api/config/' + encodeURIComponent(key), { method: 'DELETE' });
          if (!res.ok) throw new Error(await res.text());
        } catch (e) {
          if (deleted) configData.push(deleted);
          renderConfig();
          showToast('Delete failed: ' + e.message, 'err');
        }
        pendingDeleteKey = null;
      }, 4000);
    }

    function editEntry(key) {
      const current = configData.find(e => e.key === key);
      const newVal = prompt('Edit value for ' + key + ':', current ? current.value : '');
      if (newVal === null) return;
      void putEntry(key, newVal);
    }

    async function saveEntry() {
      const keyEl = document.getElementById('new-key');
      const valEl = document.getElementById('new-value');
      const key = keyEl.value.trim();
      const value = valEl.value.trim();
      let hasError = false;
      if (!key) {
        setFieldInvalid(keyEl, 'new-key-error', 'Key is required. Enter a dot-separated path like capability.github.');
        hasError = true;
      } else { setFieldValid(keyEl, 'new-key-error'); }
      if (!value) {
        setFieldInvalid(valEl, 'new-value-error', 'Value is required. Enter a valid JSON value.');
        hasError = true;
      } else {
        const jsonValid = validateJsonField(valEl, 'new-value-error');
        if (!jsonValid) hasError = true;
      }
      if (hasError) return;
      const btn = document.getElementById('add-btn');
      btn.textContent = 'Saving…';
      btn.classList.add('saving');
      btn.setAttribute('aria-disabled', 'true');
      await putEntry(key, value);
      btn.textContent = 'Save entry';
      btn.classList.remove('saving');
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.title = 'No changes to save';
      keyEl.value = '';
      valEl.value = '';
      setFieldValid(keyEl, 'new-key-error');
      setFieldValid(valEl, 'new-value-error');
    }

    async function putEntry(key, value) {
      try {
        const res = await fetch('/api/config/' + encodeURIComponent(key), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: JSON.parse(value) }),
        });
        if (!res.ok) throw new Error(await res.text());
        showToast('Saved ' + key, 'ok');
        await loadConfig();
      } catch (e) {
        showToast('Save failed: ' + e.message, 'err');
      }
    }

    // ── Health ─────────────────────────────────────────────────────────────
    async function loadHealth() {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        const uptimeSec = Math.floor(data.uptime);
        const h = Math.floor(uptimeSec / 3600);
        const m = Math.floor((uptimeSec % 3600) / 60);
        const s = uptimeSec % 60;
        const uptimeStr = h > 0 ? h + 'h ' + m + 'm' : m > 0 ? m + 'm ' + s + 's' : s + 's';
        document.getElementById('health-uptime').textContent = 'Uptime: ' + uptimeStr;
        document.getElementById('health-tools').innerHTML =
          '<strong>' + data.tools.length + '</strong> tools registered';
        const dot = document.getElementById('status-dot');
        const txt = document.getElementById('status-text');
        dot.classList.add('ok');
        txt.textContent = 'running';
      } catch {
        const txt = document.getElementById('status-text');
        if (txt) txt.textContent = 'unreachable';
        const uptime = document.getElementById('health-uptime');
        if (uptime) uptime.textContent = 'Health check failed';
      }
    }

    // ── Raw config toggle ──────────────────────────────────────────────────
    function toggleRaw() {
      const section = document.getElementById('raw-section');
      const btn = section.querySelector('.raw-toggle');
      const isOpen = section.classList.toggle('open');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    // ── Compliance toggle ──────────────────────────────────────────────────
    function toggleCompliance() {
      const section = document.getElementById('compliance-section');
      const btn = section.querySelector('.compliance-toggle');
      const isOpen = section.classList.toggle('open');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    // ── Compliance ─────────────────────────────────────────────────────────
    async function loadCompliance() {
      try {
        const res = await fetch('/api/compliance');
        const data = await res.json();
        const h = data.hipaa;

        const baaStatusMap = {
          verified:  ['status-ok',   '✓ verified'],
          confirmed: ['status-ok',   '✓ confirmed'],
          'no-baa':  ['status-err',  '✗ no BAA'],
          unknown:   ['status-dim',  '? unknown'],
        };
        const baaBody = document.getElementById('baa-body');
        baaBody.innerHTML = Object.entries(h.baaStatus).map(([svc, status]) => {
          const [cls, label] = baaStatusMap[status] ?? ['status-dim', status];
          return \`<tr>
            <td class="col-service">\${escHtml(svc)}</td>
            <td class="col-status"><span class="status-badge \${cls}">\${escHtml(label)}</span></td>
          </tr>\`;
        }).join('');

        const encStatusMap = {
          cmk:          ['status-ok',   '✓ CMK'],
          'aws-managed':['status-warn', '~ AWS-managed'],
          unknown:      ['status-dim',  '? unknown'],
        };
        const encBody = document.getElementById('enc-body');
        encBody.innerHTML = Object.entries(h.encryption).map(([resource, status]) => {
          const [cls, label] = encStatusMap[status] ?? ['status-dim', status];
          return \`<tr>
            <td class="col-service">\${escHtml(resource)}</td>
            <td class="col-status"><span class="status-badge \${cls}">\${escHtml(label)}</span></td>
          </tr>\`;
        }).join('');

        const al = h.auditLogging;
        const lastEntry = al.lastEntryAt ? new Date(al.lastEntryAt).toLocaleString() : 'never';
        const auditBody = document.getElementById('audit-body');
        auditBody.innerHTML = \`
          <tr><td class="col-service">enabled</td><td class="col-detail">\${al.enabled ? '✓ yes' : '✗ no'}</td></tr>
          <tr><td class="col-service">entry count</td><td class="col-detail">\${al.entryCount.toLocaleString()}</td></tr>
          <tr><td class="col-service">last entry</td><td class="col-detail">\${escHtml(lastEntry)}</td></tr>
          <tr><td class="col-service">retention</td><td class="col-detail">\${al.retentionDays} days</td></tr>
        \`;

        const dr = h.dataRetention;
        const retentionBody = document.getElementById('retention-body');
        retentionBody.innerHTML = \`
          <tr><td class="col-service">TTL enabled</td><td class="col-detail">\${dr.ttlEnabled ? '✓ yes' : '✗ no'}</td></tr>
          <tr><td class="col-service">history retention</td><td class="col-detail">\${dr.historyRetentionDays} days</td></tr>
          <tr><td class="col-service">audit retention</td><td class="col-detail">\${dr.auditRetentionDays} days</td></tr>
        \`;

        document.getElementById('compliance-loading').style.display = 'none';
        document.getElementById('compliance-content').style.display = 'block';
      } catch (e) {
        const el = document.getElementById('compliance-loading');
        if (el) el.textContent = 'Failed to load compliance data: ' + e.message;
      }
    }

    // ── Toast ──────────────────────────────────────────────────────────────
    let toastTimer = null;
    let toastUndoFn = null;

    function showToast(text, type, undoLabel, undoFn) {
      const el = document.getElementById('toast');
      const textEl = document.getElementById('toast-text');
      const undoBtn = document.getElementById('toast-undo');
      textEl.textContent = text;
      el.className = 'show ' + (type || '');
      if (undoLabel && undoFn) {
        undoBtn.textContent = undoLabel;
        undoBtn.style.display = 'inline';
        toastUndoFn = undoFn;
        undoBtn.onclick = () => {
          clearTimeout(toastTimer);
          el.className = '';
          const fn = toastUndoFn;
          toastUndoFn = null;
          if (fn) fn();
        };
      } else {
        undoBtn.style.display = 'none';
        toastUndoFn = null;
      }
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        el.className = '';
        toastUndoFn = null;
      }, undoFn ? 4000 : 3500);
    }

    // ── Utilities ──────────────────────────────────────────────────────────
    function escHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    init();
  </script>
</body>
</html>`;
}
