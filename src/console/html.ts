/**
 * Self-contained HTML page for the tino config console.
 * No build step, no framework — inline CSS + JS only.
 *
 * Design: warm professional service aesthetic. Dark navy base, warm amber accent,
 * silver neutral. 3:4 proportional system. System font stack + monospace for values.
 * Capability cards expand inline. Health as footer. No cyan-on-dark, no glassmorphism.
 */
export function getConsoleHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
    }
    #toast.ok  { border-color: var(--ok);  color: var(--ok); }
    #toast.err { border-color: var(--err); color: var(--err); }

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
    }
    .cap-header:hover { background: rgba(200, 149, 106, 0.04); }

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

    /* ── Toggle switch ──────────────────────────────────────────────────── */
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
    .toggle input:checked ~ .toggle-track { background: var(--accent-dim); }
    .toggle input:checked ~ .toggle-thumb {
      transform: translateX(14px);
      background: var(--accent);
    }
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

    /* ── Credential / setting rows ──────────────────────────────────────── */
    .field-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .field-key {
      font-family: var(--mono);
      font-size: 0.786rem;
      color: var(--silver);
      min-width: 110px;
      flex-shrink: 0;
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
      padding: 5px 8px;
      transition: border-color 100ms;
    }
    .field-input:focus {
      outline: none;
      border-color: var(--accent-dim);
    }
    .field-input::placeholder { color: var(--text-dim); }

    /* Reveal button for password fields */
    .reveal-btn {
      background: none;
      border: none;
      color: var(--text-dim);
      cursor: pointer;
      padding: 4px;
      font-size: 0.786rem;
      line-height: 1;
      border-radius: var(--radius-sm);
      flex-shrink: 0;
      transition: color 100ms;
    }
    .reveal-btn:hover { color: var(--silver); }
    .reveal-btn:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    /* ── Buttons ────────────────────────────────────────────────────────── */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--bg-inset);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-sec);
      font-family: var(--sans);
      font-size: 0.786rem;
      padding: 5px 10px;
      cursor: pointer;
      transition: background 100ms, border-color 100ms, color 100ms;
      min-height: 28px;
    }
    .btn:hover { background: var(--bg-raised); border-color: var(--border); color: var(--text-prim); }
    .btn:active { transform: scale(0.98); }
    .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    .btn-primary {
      background: rgba(200, 149, 106, 0.1);
      border-color: var(--accent-dim);
      color: var(--accent);
    }
    .btn-primary:hover {
      background: rgba(200, 149, 106, 0.18);
      border-color: var(--accent);
      color: var(--accent);
    }

    .btn-danger {
      color: var(--err);
      border-color: rgba(192, 96, 96, 0.3);
    }
    .btn-danger:hover {
      background: rgba(192, 96, 96, 0.08);
      border-color: var(--err);
    }

    /* Save button states */
    .btn-save { min-width: 72px; justify-content: center; }
    .btn-save.saving { opacity: 0.6; pointer-events: none; }
    .btn-save.saved {
      background: rgba(106, 171, 122, 0.1);
      border-color: rgba(106, 171, 122, 0.4);
      color: var(--ok);
    }

    .btn-row {
      display: flex;
      gap: 8px;
      margin-top: 10px;
      flex-wrap: wrap;
    }

    /* ── findWork row ───────────────────────────────────────────────────── */
    .fw-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .fw-label {
      font-size: 0.857rem;
      color: var(--text-sec);
    }
    .fw-interval-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.786rem;
      color: var(--text-dim);
    }
    .fw-interval-input {
      width: 52px;
      background: var(--bg-inset);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-prim);
      font-family: var(--mono);
      font-size: 0.786rem;
      padding: 4px 6px;
      text-align: center;
    }
    .fw-interval-input:focus { outline: none; border-color: var(--accent-dim); }

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
      padding: 0;
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

    /* ── Add entry form ─────────────────────────────────────────────────── */
    .add-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: flex-end;
    }
    .add-row .field-input { flex: 1; min-width: 120px; }

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

    /* ── Empty state ────────────────────────────────────────────────────── */
    .empty {
      color: var(--text-dim);
      font-size: 0.857rem;
      font-style: italic;
      padding: 8px 0;
    }

    /* ── Responsive ─────────────────────────────────────────────────────── */
    @media (max-width: 480px) {
      .cap-badges { display: none; } /* show only toggle + chevron on narrow */
      .field-row { flex-wrap: wrap; }
      .field-key { min-width: 80px; }
      .config-table .col-ts { display: none; }
      .add-row { flex-direction: column; }
      .add-row .field-input { width: 100%; }
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
            <div class="add-row">
              <input class="field-input" type="text" id="new-key" placeholder="key (e.g. capability.github)" aria-label="Config key">
              <input class="field-input" type="text" id="new-value" placeholder='value (JSON)' aria-label="Config value (JSON)">
              <button class="btn btn-primary btn-save" id="add-btn" onclick="saveEntry()">Save</button>
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

  <!-- ── Toast ─────────────────────────────────────────────────────────── -->
  <div id="toast" role="status" aria-live="polite"></div>

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
                     aria-label="Enable \${escHtml(CAP_NAMES[id] ?? id)}">
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

      // Credentials
      let credContent = '';
      if (credKeys.length === 0) {
        credContent = '<p class="empty">No credentials required.</p>';
      } else {
        credContent = credKeys.map(k => {
          const val = cfg.credentials?.[k] ?? '';
          return \`<div class="field-row">
            <span class="field-key">\${escHtml(k)}</span>
            <input class="field-input" type="password" id="cred-\${id}-\${k}"
                   value="\${escHtml(val)}" placeholder="not set"
                   aria-label="\${escHtml(k)} credential">
            <button class="reveal-btn" type="button"
                    onclick="toggleReveal('cred-\${id}-\${k}', this)"
                    aria-label="Reveal \${escHtml(k)}">show</button>
          </div>\`;
        }).join('');
        credContent += \`<div class="btn-row">
          <button class="btn btn-primary btn-save" id="save-cred-\${id}"
                  onclick="saveCredentials('\${id}')">Save credentials</button>
        </div>\`;
      }

      // Settings
      let settingContent = '';
      if (settingKeys.length === 0) {
        settingContent = '<p class="empty">No settings.</p>';
      } else {
        settingContent = settingKeys.map(k => {
          const val = cfg.settings?.[k];
          const display = val !== undefined ? JSON.stringify(val) : '';
          return \`<div class="field-row">
            <span class="field-key">\${escHtml(k)}</span>
            <input class="field-input" type="text" id="setting-\${id}-\${k}"
                   value="\${escHtml(display)}" placeholder="JSON value"
                   aria-label="\${escHtml(k)} setting">
          </div>\`;
        }).join('');
        settingContent += \`<div class="btn-row">
          <button class="btn btn-primary btn-save" id="save-setting-\${id}"
                  onclick="saveSettings('\${id}')">Save settings</button>
        </div>\`;
      }

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
            <label class="toggle" title="Enable autonomous scanning">
              <input type="checkbox" id="fw-enabled-\${id}" \${fwEnabled ? 'checked' : ''}
                     aria-label="Enable find work for \${escHtml(CAP_NAMES[id] ?? id)}">
              <span class="toggle-track"></span>
              <span class="toggle-thumb"></span>
            </label>
            <span class="fw-label">Autonomous scanning</span>
            <div class="fw-interval-wrap">
              every
              <input class="fw-interval-input" type="number" id="fw-interval-\${id}"
                     value="\${fwInterval}" min="1" max="1440"
                     aria-label="Find work interval in minutes">
              min
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
      }
    }

    // ── Capability mutations ───────────────────────────────────────────────
    async function toggleCapability(id, enabled) {
      const entry = capData.find(c => c.id === id);
      const cfg = JSON.parse(JSON.stringify(entry?.config ?? { enabled: false, credentials: {}, settings: {} }));
      cfg.enabled = enabled;
      await putCapability(id, cfg, null);
    }

    async function saveCredentials(id) {
      const entry = capData.find(c => c.id === id);
      const cfg = JSON.parse(JSON.stringify(entry?.config ?? { enabled: false, credentials: {}, settings: {} }));
      const credKeys = CAP_CRED_KEYS[id] ?? [];
      cfg.credentials = cfg.credentials ?? {};
      for (const k of credKeys) {
        const el = document.getElementById('cred-' + id + '-' + k);
        if (el) cfg.credentials[k] = el.value;
      }
      await putCapability(id, cfg, 'save-cred-' + id);
    }

    async function saveSettings(id) {
      const entry = capData.find(c => c.id === id);
      const cfg = JSON.parse(JSON.stringify(entry?.config ?? { enabled: false, credentials: {}, settings: {} }));
      const settingKeys = CAP_SETTING_KEYS[id] ?? [];
      cfg.settings = cfg.settings ?? {};
      for (const k of settingKeys) {
        const el = document.getElementById('setting-' + id + '-' + k);
        if (!el) continue;
        const raw = el.value.trim();
        if (!raw) { delete cfg.settings[k]; continue; }
        try { cfg.settings[k] = JSON.parse(raw); }
        catch { showToast('Invalid JSON for setting ' + k, 'err'); return; }
      }
      await putCapability(id, cfg, 'save-setting-' + id);
    }

    async function saveFindWork(id) {
      const entry = capData.find(c => c.id === id);
      const cfg = JSON.parse(JSON.stringify(entry?.config ?? { enabled: false, credentials: {}, settings: {} }));
      const fwEnabled = document.getElementById('fw-enabled-' + id)?.checked ?? false;
      const fwInterval = parseInt(document.getElementById('fw-interval-' + id)?.value ?? '15', 10);
      cfg.findWork = { enabled: fwEnabled, intervalMinutes: isNaN(fwInterval) ? 15 : fwInterval };
      await putCapability(id, cfg, 'save-fw-' + id);
    }

    async function putCapability(id, cfg, btnId) {
      const btn = btnId ? document.getElementById(btnId) : null;
      if (btn) { btn.textContent = 'Saving…'; btn.classList.add('saving'); }
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
          setTimeout(() => {
            btn.textContent = btn.id.startsWith('save-cred') ? 'Save credentials'
              : btn.id.startsWith('save-setting') ? 'Save settings'
              : btn.id.startsWith('save-fw') ? 'Save find work'
              : 'Save';
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
          btn.textContent = 'Error';
          btn.classList.remove('saving');
          setTimeout(() => {
            btn.textContent = 'Retry';
          }, 1500);
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
      } else {
        input.type = 'password';
        btn.textContent = 'show';
      }
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
            <button class="btn btn-danger" onclick="deleteEntry('\${safeKey}')">Delete</button>
          </td>
        </tr>\`;
      }).join('');
    }

    function editEntry(key) {
      const current = configData.find(e => e.key === key);
      const newVal = prompt('Edit value for ' + key + ':', current ? current.value : '');
      if (newVal === null) return;
      void putEntry(key, newVal);
    }

    async function deleteEntry(key) {
      if (!confirm('Delete ' + key + '?')) return;
      try {
        const res = await fetch('/api/config/' + encodeURIComponent(key), { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        showToast('Deleted ' + key, 'ok');
        await loadConfig();
      } catch (e) {
        showToast('Delete failed: ' + e.message, 'err');
      }
    }

    async function saveEntry() {
      const key = document.getElementById('new-key').value.trim();
      const value = document.getElementById('new-value').value.trim();
      if (!key) { showToast('Key is required', 'err'); return; }
      if (!value) { showToast('Value is required', 'err'); return; }
      try { JSON.parse(value); } catch { showToast('Value must be valid JSON', 'err'); return; }
      const btn = document.getElementById('add-btn');
      btn.textContent = 'Saving…';
      btn.classList.add('saving');
      await putEntry(key, value);
      btn.textContent = 'Save';
      btn.classList.remove('saving');
      document.getElementById('new-key').value = '';
      document.getElementById('new-value').value = '';
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

    // ── Toast ──────────────────────────────────────────────────────────────
    let toastTimer = null;
    function showToast(text, type) {
      const el = document.getElementById('toast');
      el.textContent = text;
      el.className = 'show ' + (type || '');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.className = ''; }, 3500);
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
