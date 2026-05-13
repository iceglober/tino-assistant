/**
 * Self-contained HTML page for the tino config console.
 * No build step, no framework — inline CSS + JS only.
 *
 * Design: warm professional service aesthetic. Dark navy base, warm amber accent,
 * silver neutral. 3:4 proportional system. System font stack + monospace for values.
 * Capability cards expand inline. Health as footer. No cyan-on-dark, no glassmorphism.
 *
 * Interaction design: 8-state model on all interactive elements, labels above inputs,
 * blur validation, inline error messages (what/why/how), focus management on expand,
 * undo toasts for destructive actions, helpful empty states.
 */
export function getConsoleHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/png" href="/assets/tino-logo.png">
  <title>tino — configuration</title>
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

    /* ── Header ─────────────────────────────────────────────────────────── */
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
      font-size: 1.357rem; /* ~19px */
      font-weight: 600;
      color: var(--text-prim);
      letter-spacing: -0.01em;
    }
    .header-sub {
      font-size: 0.786rem; /* ~11px */
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

    /* ── Section labels ─────────────────────────────────────────────────── */
    .section-label {
      font-size: 0.786rem;
      font-weight: 600;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--text-dim);
      margin-bottom: 12px;
    }

    /* ── Toast message ──────────────────────────────────────────────────── */
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
    #toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
      pointer-events: auto;
    }
    #toast.ok  { border-color: var(--ok);  color: var(--ok); }
    #toast.err { border-color: var(--err); color: var(--err); }

    /* Toast undo button */
    #toast-undo {
      background: none;
      border: none;
      color: inherit;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      padding: 0 0 0 10px;
      text-decoration: underline;
      opacity: 0.85;
    }
    #toast-undo:hover { opacity: 1; }
    #toast-undo:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
      border-radius: 2px;
    }

    /* ── Capability list ────────────────────────────────────────────────── */
    .cap-list {
      display: flex;
      flex-direction: column;
      gap: 1px;
      background: var(--border-sub);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      margin-bottom: 28px;
    }

    /* ── Capability item ────────────────────────────────────────────────── */
    .cap-item {
      background: var(--bg-raised);
    }
    .cap-item + .cap-item {
      border-top: 1px solid var(--border-sub);
    }

    /* Left border indicates health: accent = ok, err = needs setup, dim = disabled */
    .cap-item { border-left: 3px solid transparent; }
    .cap-item.state-ok       { border-left-color: var(--ok); }
    .cap-item.state-warn     { border-left-color: var(--err); }
    .cap-item.state-disabled { border-left-color: var(--border); }

    /* ── Capability header row ──────────────────────────────────────────── */
    .cap-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      cursor: pointer;
      user-select: none;
      min-height: 52px; /* 44px touch target + breathing room */
      transition: background 100ms;
    }
    .cap-header:hover { background: rgba(200, 149, 106, 0.04); }
    .cap-header:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }

    .cap-name {
      font-size: 0.929rem; /* ~13px */
      font-weight: 600;
      color: var(--text-prim);
      flex: 1;
      min-width: 0;
    }

    .cap-badges {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .badge {
      font-size: 0.714rem; /* ~10px */
      font-family: var(--mono);
      padding: 2px 6px;
      border-radius: 3px;
      white-space: nowrap;
    }
    .badge-ok      { background: rgba(106, 171, 122, 0.12); color: var(--ok); }
    .badge-warn    { background: rgba(192, 96, 96, 0.12);   color: var(--err); }
    .badge-neutral { background: rgba(168, 176, 188, 0.1);  color: var(--silver); }
    .badge-accent  { background: rgba(200, 149, 106, 0.12); color: var(--accent); }

    /* ── Toggle switch — all 8 states ───────────────────────────────────── */
    .toggle-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
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
    /* Hover state */
    .toggle:hover .toggle-track { background: #3a4e68; }
    .toggle input:checked ~ .toggle-track { background: var(--accent-dim); }
    .toggle input:checked:hover ~ .toggle-track { background: #9a6040; }
    /* Active state */
    .toggle:active .toggle-track { transform: scale(0.96); }
    /* Disabled state */
    .toggle input:disabled ~ .toggle-track {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .toggle input:disabled ~ .toggle-thumb {
      opacity: 0.4;
      cursor: not-allowed;
    }
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
    /* Focus state — keyboard only */
    .toggle input:focus-visible ~ .toggle-track {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    /* ── Expand chevron ─────────────────────────────────────────────────── */
    .cap-chevron {
      width: 16px;
      height: 16px;
      color: var(--text-dim);
      flex-shrink: 0;
      transition: transform 200ms cubic-bezier(0.65, 0, 0.35, 1);
    }
    .cap-item.open .cap-chevron { transform: rotate(90deg); }

    /* ── Capability detail (expand/collapse via grid trick) ─────────────── */
    .cap-detail-wrap {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 220ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    .cap-item.open .cap-detail-wrap {
      grid-template-rows: 1fr;
    }
    .cap-detail-inner {
      overflow: hidden;
    }
    .cap-detail {
      padding: 0 16px 16px 19px; /* 19px = 16px + 3px border offset */
      border-top: 1px solid var(--border-sub);
    }

    /* ── Detail sections ────────────────────────────────────────────────── */
    .detail-section {
      margin-top: 16px;
    }
    .detail-section:first-child { margin-top: 12px; }

    .detail-label {
      font-size: 0.714rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-dim);
      margin-bottom: 8px;
    }

    /* ── Form field group — label above input ───────────────────────────── */
    /* Hierarchy: label (dim, small) → input → helper text (dim, smaller) → error (err, smaller) */
    .field-group {
      margin-bottom: 12px;
    }
    .field-label {
      display: block;
      font-family: var(--mono);
      font-size: 0.786rem;
      color: var(--silver);
      margin-bottom: 4px;
      font-weight: 500;
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
      font-size: 0.786rem;
      padding: 6px 8px;
      /* Default state: no outline override — browser default removed, replaced below */
      outline: none;
      transition: border-color 100ms, box-shadow 100ms;
      min-height: 32px;
    }
    /* Focus state — keyboard and mouse (box-shadow approach for inputs) */
    .field-input:focus-visible {
      border-color: var(--accent-dim);
      box-shadow: 0 0 0 2px rgba(200, 149, 106, 0.25);
    }
    /* Hover state */
    .field-input:hover:not(:focus-visible):not([aria-invalid="true"]) {
      border-color: #3a4e68;
    }
    /* Error state */
    .field-input[aria-invalid="true"] {
      border-color: var(--err);
      box-shadow: 0 0 0 2px rgba(192, 96, 96, 0.15);
    }
    /* Success state — brief flash applied via JS */
    .field-input.field-success {
      border-color: var(--ok);
      box-shadow: 0 0 0 2px rgba(106, 171, 122, 0.2);
    }
    /* Disabled state */
    .field-input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .field-input::placeholder { color: var(--text-dim); }

    /* Helper text below input — format hint, always visible */
    .field-hint {
      font-size: 0.714rem;
      color: var(--text-dim);
      margin-top: 3px;
      line-height: 1.4;
    }

    /* Inline error message — what happened, why, how to fix */
    /* Fades in 150ms ease-out per motion.md */
    .field-error {
      font-size: 0.714rem;
      color: var(--err);
      margin-top: 3px;
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
      padding: 5px 8px;
      font-size: 0.714rem;
      font-family: var(--sans);
      line-height: 1;
      border-radius: var(--radius-sm);
      flex-shrink: 0;
      min-height: 32px;
      min-width: 44px;
      transition: color 100ms, border-color 100ms, background 100ms;
    }
    /* Hover */
    .reveal-btn:hover { color: var(--silver); border-color: #3a4e68; background: rgba(168,176,188,0.05); }
    /* Active */
    .reveal-btn:active { transform: scale(0.97); }
    /* Focus */
    .reveal-btn:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    /* ── Buttons — all 8 states ─────────────────────────────────────────── */
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
      font-size: 0.786rem;
      padding: 6px 12px;
      cursor: pointer;
      transition: background 100ms, border-color 100ms, color 100ms, transform 100ms, opacity 100ms;
      min-height: 32px;
      min-width: 44px;
      white-space: nowrap;
    }
    /* Hover */
    .btn:hover:not(:disabled):not(.saving) {
      background: var(--bg-raised);
      border-color: #3a4e68;
      color: var(--text-prim);
    }
    /* Focus */
    .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    /* Active */
    .btn:active:not(:disabled):not(.saving) { transform: scale(0.97); }
    /* Disabled */
    .btn:disabled, .btn[aria-disabled="true"] {
      opacity: 0.45;
      cursor: not-allowed;
      pointer-events: none;
    }

    /* Primary button */
    .btn-primary {
      background: rgba(200, 149, 106, 0.1);
      border-color: var(--accent-dim);
      color: var(--accent);
    }
    .btn-primary:hover:not(:disabled):not(.saving) {
      background: rgba(200, 149, 106, 0.18);
      border-color: var(--accent);
      color: var(--accent);
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

    /* Save button — 8 states: default, hover, focus, active, disabled, loading, error, success */
    .btn-save { min-width: 120px; }

    /* Loading state */
    .btn-save.saving {
      opacity: 0.65;
      cursor: wait;
      pointer-events: none;
    }

    /* Success state — green flash, 2s per interaction.md */
    .btn-save.saved {
      background: rgba(106, 171, 122, 0.12);
      border-color: rgba(106, 171, 122, 0.5);
      color: var(--ok);
    }

    /* Error state */
    .btn-save.save-error {
      background: rgba(192, 96, 96, 0.1);
      border-color: rgba(192, 96, 96, 0.5);
      color: var(--err);
    }

    .btn-row {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
    }

    /* ── Empty state — guides users toward action ────────────────────────── */
    .empty {
      color: var(--text-dim);
      font-size: 0.857rem;
      font-style: italic;
      padding: 8px 0;
    }

    /* Helpful empty state for capabilities needing credentials */
    .empty-state {
      padding: 12px 0 4px;
    }
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
    .empty-state-link:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
      border-radius: 2px;
    }

    /* ── findWork section ───────────────────────────────────────────────── */
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
      padding-top: 2px; /* align with label baseline */
    }
    .fw-label {
      font-size: 0.857rem;
      color: var(--text-sec);
    }

    /* findWork interval — field-group pattern */
    .fw-interval-group {
      flex: 1;
      min-width: 120px;
    }
    .fw-interval-label {
      display: block;
      font-size: 0.786rem;
      color: var(--text-dim);
      margin-bottom: 4px;
    }
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
    /* Focus — replaced outline: none with visible focus-visible */
    .fw-interval-input:focus-visible {
      border-color: var(--accent-dim);
      box-shadow: 0 0 0 2px rgba(200, 149, 106, 0.25);
    }
    .fw-interval-input:hover:not(:focus-visible) { border-color: #3a4e68; }
    .fw-interval-input[aria-invalid="true"] {
      border-color: var(--err);
      box-shadow: 0 0 0 2px rgba(192, 96, 96, 0.15);
    }

    /* ── Raw config section ─────────────────────────────────────────────── */
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

    /* ── Add entry form — labels above inputs ───────────────────────────── */
    .add-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
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
    /* No cell borders — alignment and white space do the work (Tufte 1+1=3) */
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
    .config-table .col-key {
      font-family: var(--mono);
      color: var(--silver);
      white-space: nowrap;
      padding-right: 16px;
    }
    .config-table .col-val {
      font-family: var(--mono);
      color: var(--text-sec);
      word-break: break-all;
    }
    .config-table .col-ts {
      color: var(--text-dim);
      white-space: nowrap;
      padding-right: 12px;
    }
    .config-table .col-act { white-space: nowrap; }

    /* Inline delete confirmation — slides in from right, 200ms per motion.md */
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
    .delete-confirm.visible {
      opacity: 1;
      transform: translateX(0);
      pointer-events: auto;
    }
    .col-act { position: relative; }
    .delete-confirm-text {
      font-size: 0.714rem;
      color: var(--err);
    }
    .delete-confirm-yes {
      background: none;
      border: none;
      color: var(--err);
      font-size: 0.714rem;
      font-weight: 600;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 2px;
      min-height: 24px;
      min-width: 44px;
    }
    .delete-confirm-yes:hover { background: rgba(192, 96, 96, 0.12); }
    .delete-confirm-yes:focus-visible { outline: 2px solid var(--err); outline-offset: 1px; }
    .delete-confirm-no {
      background: none;
      border: none;
      color: var(--text-dim);
      font-size: 0.714rem;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 2px;
      min-height: 24px;
      min-width: 44px;
    }
    .delete-confirm-no:hover { color: var(--text-sec); }
    .delete-confirm-no:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

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
    .health-uptime {
      font-size: 0.714rem;
      color: var(--text-dim);
    }
    .health-tools {
      font-size: 0.714rem;
      color: var(--text-dim);
    }
    .health-tools strong {
      color: var(--text-sec);
      font-weight: 500;
    }

    /* ── Responsive ─────────────────────────────────────────────────────── */
    @media (max-width: 480px) {
      .cap-badges { display: none; } /* show only toggle + chevron on narrow */
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

    <!-- ── Header ──────────────────────────────────────────────────────── -->
    <header class="header">
      <img src="/assets/tino-logo.png" alt="tino" class="header-logo">
      <div>
        <div class="header-wordmark">tino</div>
        <div class="header-sub">configuration console · localhost only</div>
      </div>
      <div class="header-status" id="header-status">
        <span class="status-dot" id="status-dot"></span>
        <span id="status-text">loading…</span>
      </div>
    </header>

    <!-- ── Capabilities ────────────────────────────────────────────────── -->
    <div class="section-label">Capabilities</div>
    <div class="cap-list" id="cap-list">
      <div class="empty" style="padding:16px">Loading…</div>
    </div>

    <!-- ── Raw config (collapsible) ────────────────────────────────────── -->
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
                  <label class="field-label" for="new-key">Key</label>
                  <input class="field-input" type="text" id="new-key"
                         placeholder="capability.github"
                         aria-describedby="new-key-hint new-key-error">
                  <div class="field-hint" id="new-key-hint">e.g. capability.github</div>
                  <div class="field-error" id="new-key-error" role="alert" aria-live="polite"></div>
                </div>
                <div class="field-group">
                  <label class="field-label" for="new-value">Value <span style="font-weight:400;color:var(--text-dim)">(JSON)</span></label>
                  <input class="field-input" type="text" id="new-value"
                         placeholder='"value" or true or 42'
                         aria-describedby="new-value-hint new-value-error">
                  <div class="field-hint" id="new-value-hint">Must be valid JSON</div>
                  <div class="field-error" id="new-value-error" role="alert" aria-live="polite"></div>
                </div>
              </div>
              <div>
                <button class="btn btn-primary btn-save" id="add-btn" onclick="saveEntry()">Save entry</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Health footer ───────────────────────────────────────────────── -->
    <footer class="health-footer" id="health-footer">
      <span class="health-uptime" id="health-uptime">—</span>
      <span class="health-tools" id="health-tools">—</span>
    </footer>

  </div>

  <!-- ── Toast (with optional undo action) ─────────────────────────────── -->
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

    // ── Capability metadata ────────────────────────────────────────────────
    const CAP_NAMES = {
      github:     'GitHub',
      linear:     'Linear',
      slack:      'Slack',
      gmail:      'Gmail',
      calendar:   'Calendar',
      cloudwatch: 'CloudWatch',
    };

    const CAP_CRED_KEYS = {
      github:     ['token'],
      linear:     ['token'],
      slack:      ['userToken'],
      gmail:      ['clientId', 'clientSecret', 'refreshToken'],
      calendar:   ['clientId', 'clientSecret', 'refreshToken'],
      cloudwatch: [],
    };

    // Placeholder hints for credential fields — format expectations before errors
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

    // Helpful empty state copy for capabilities that need credentials but have none
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

    // ── Bootstrap ──────────────────────────────────────────────────────────
    async function loadAll() {
      await Promise.all([loadCapabilities(), loadConfig(), loadHealth()]);
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
      const list = document.getElementById('cap-list');
      const allIds = Object.keys(CAP_NAMES);

      if (allIds.length === 0) {
        list.innerHTML = '<div class="empty" style="padding:16px">No capabilities configured.</div>';
        return;
      }

      list.innerHTML = allIds.map(id => {
        const { enabled, credSet, credKeys, cfg } = capState(id);
        const fwEnabled = cfg?.findWork?.enabled ?? false;

        // Left border state
        let stateClass = 'state-disabled';
        if (enabled && credSet) stateClass = 'state-ok';
        else if (enabled && !credSet) stateClass = 'state-warn';

        // Badges
        let credBadge = '';
        if (credKeys.length === 0) {
          credBadge = '<span class="badge badge-neutral">no creds</span>';
        } else if (credSet) {
          credBadge = '<span class="badge badge-ok">✓ creds</span>';
        } else {
          credBadge = '<span class="badge badge-warn">✗ creds</span>';
        }
        const fwBadge = fwEnabled
          ? '<span class="badge badge-accent">find work</span>'
          : '';

        const isOpen = openCapId === id;

        return \`<div class="cap-item \${stateClass}\${isOpen ? ' open' : ''}" id="cap-item-\${id}">
          <div class="cap-header" onclick="toggleCapDetail('\${id}')" role="button" tabindex="0"
               aria-expanded="\${isOpen}" aria-controls="cap-detail-\${id}"
               onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleCapDetail('\${id}')}">
            <span class="cap-name">\${escHtml(CAP_NAMES[id] ?? id)}</span>
            <div class="cap-badges">
              \${credBadge}
              \${fwBadge}
            </div>
            <label class="toggle" title="\${enabled ? 'Disable' : 'Enable'} \${CAP_NAMES[id] ?? id}"
                   onclick="event.stopPropagation()">
              <input type="checkbox" \${enabled ? 'checked' : ''}
                     onchange="toggleCapability('\${id}', this.checked)"
                     aria-label="Enable \${escHtml(CAP_NAMES[id] ?? id)}"
                     aria-checked="\${enabled}">
              <span class="toggle-track"></span>
              <span class="toggle-thumb"></span>
            </label>
            <svg class="cap-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                 stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="5,3 11,8 5,13"/>
            </svg>
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

      // Credentials section
      let credContent = '';
      if (credKeys.length === 0) {
        // No credentials required — neutral empty state
        credContent = '<p class="empty">No credentials required.</p>';
      } else {
        // Check if any credentials are set
        const creds = cfg.credentials ?? {};
        const anySet = credKeys.some(k => creds[k]);

        if (!anySet && emptyState) {
          // Helpful empty state: what to do and where to get credentials
          credContent = \`<div class="empty-state">
            <p class="empty-state-msg">\${escHtml(emptyState.msg)}</p>
            <a class="empty-state-link" href="\${escHtml(emptyState.link)}" target="_blank" rel="noopener noreferrer">\${escHtml(emptyState.linkText)}</a>
          </div>\`;
        }

        // Always render the credential inputs (even when showing empty state)
        credContent += credKeys.map(k => {
          const val = creds[k] ?? '';
          const hint = credHints[k] ?? {};
          const inputId = 'cred-' + id + '-' + k;
          const hintId = inputId + '-hint';
          const errId = inputId + '-error';
          return \`<div class="field-group">
            <label class="field-label" for="\${inputId}">\${escHtml(k)}</label>
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
          <button class="btn btn-primary btn-save" id="save-cred-\${id}"
                  onclick="saveCredentials('\${id}')">Save credentials</button>
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
            <label class="field-label" for="\${inputId}">\${escHtml(k)}</label>
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
          <button class="btn btn-primary btn-save" id="save-setting-\${id}"
                  onclick="saveSettings('\${id}')">Save settings</button>
        </div>\`;
      }

      // findWork section
      const fwIntervalInputId = 'fw-interval-' + id;
      const fwIntervalErrId = fwIntervalInputId + '-error';

      return \`
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
                       aria-label="Enable find work for \${escHtml(CAP_NAMES[id] ?? id)}"
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
            <button class="btn btn-primary btn-save" id="save-fw-\${id}"
                    onclick="saveFindWork('\${id}')">Save find work</button>
          </div>
        </div>
      \`;
    }

    function toggleCapDetail(id) {
      const item = document.getElementById('cap-item-' + id);
      if (!item) return;
      const isOpen = item.classList.contains('open');
      if (isOpen) {
        item.classList.remove('open');
        item.querySelector('.cap-header').setAttribute('aria-expanded', 'false');
        openCapId = null;
      } else {
        item.classList.add('open');
        item.querySelector('.cap-header').setAttribute('aria-expanded', 'true');
        openCapId = id;
        // Focus management: move focus to first interactive element inside the detail
        // after the expand animation completes (220ms)
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
      // Update aria-checked on the toggle
      const toggle = document.querySelector('#cap-item-' + id + ' input[type="checkbox"][aria-label^="Enable"]');
      if (toggle) toggle.setAttribute('aria-checked', String(enabled));
      await putCapability(id, cfg, null);
    }

    async function saveCredentials(id) {
      const entry = capData.find(c => c.id === id);
      const cfg = JSON.parse(JSON.stringify(entry?.config ?? { enabled: false, credentials: {}, settings: {} }));
      const credKeys = CAP_CRED_KEYS[id] ?? [];
      cfg.credentials = cfg.credentials ?? {};

      // Validate all credential fields before saving
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

      // Validate all setting fields before saving
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

      // Validate interval before saving
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
          // Success state: 2s per interaction.md, then restore
          setTimeout(() => {
            btn.textContent = btn.id.startsWith('save-cred') ? 'Save credentials'
              : btn.id.startsWith('save-setting') ? 'Save settings'
              : btn.id.startsWith('save-fw') ? 'Save find work'
              : 'Save entry';
            btn.classList.remove('saved');
          }, 2000);
        }
        showToast((CAP_NAMES[id] ?? id) + ' saved', 'ok');
        await loadCapabilities();
        // Re-open if it was open
        if (openCapId === id) {
          const item = document.getElementById('cap-item-' + id);
          if (item) item.classList.add('open');
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

    // ── Validation — blur handlers ─────────────────────────────────────────
    // Returns true if valid, false if invalid.

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

    // Credential format validators — what happened, why, how to fix
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
      if (!validator) {
        // No specific validator — just check non-empty if field has a value
        setFieldValid(input, errId);
        return true;
      }
      const error = validator(input.value.trim());
      if (error) {
        setFieldInvalid(input, errId, error);
        return false;
      }
      setFieldValid(input, errId);
      return true;
    }

    function validateJsonField(input, errId) {
      const raw = input.value.trim();
      if (!raw) {
        setFieldValid(input, errId);
        return true;
      }
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

    // Pending delete state for undo
    let pendingDeleteKey = null;
    let pendingDeleteTimer = null;

    function initiateDelete(event, key, btn) {
      event.stopPropagation();
      // Hide any other open confirmations first
      document.querySelectorAll('.delete-confirm.visible').forEach(el => {
        el.classList.remove('visible');
      });
      const confirm = document.getElementById('del-confirm-' + key);
      if (!confirm) return;
      confirm.classList.add('visible');
      // Focus the "Yes" button for keyboard users
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

      // Optimistic: remove from local state and re-render
      const deleted = configData.find(e => e.key === key);
      configData = configData.filter(e => e.key !== key);
      renderConfig();

      // Show undo toast — user has 4s to undo
      showToast('Deleted ' + key, 'ok', 'Undo', async () => {
        // Undo: restore the entry
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

      // Actually delete after 4s (undo window)
      clearTimeout(pendingDeleteTimer);
      pendingDeleteKey = key;
      pendingDeleteTimer = setTimeout(async () => {
        if (pendingDeleteKey !== key) return; // was undone
        try {
          const res = await fetch('/api/config/' + encodeURIComponent(key), { method: 'DELETE' });
          if (!res.ok) throw new Error(await res.text());
        } catch (e) {
          // Delete failed — restore
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
      } else {
        setFieldValid(keyEl, 'new-key-error');
      }

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
      btn.removeAttribute('aria-disabled');
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
        document.getElementById('status-text').textContent = 'unreachable';
        document.getElementById('health-uptime').textContent = 'Health check failed';
      }
    }

    // ── Raw config toggle ──────────────────────────────────────────────────
    function toggleRaw() {
      const section = document.getElementById('raw-section');
      const btn = section.querySelector('.raw-toggle');
      const isOpen = section.classList.toggle('open');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }

    // ── Toast (with optional undo action) ─────────────────────────────────
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

    loadAll();
  </script>
</body>
</html>`;
}
