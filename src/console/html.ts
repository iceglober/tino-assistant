/**
 * Self-contained HTML page for the tino config console.
 * No build step, no framework — inline CSS + JS only.
 *
 * Capability-centric UI: list capabilities with enable/disable toggles,
 * credential editing, allowlist management, and findWork toggles.
 */
export function getConsoleHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>tino config console</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: #0f0f0f;
      color: #e0e0e0;
      padding: 24px;
      max-width: 960px;
      margin: 0 auto;
    }
    h1 { font-size: 1.4rem; color: #fff; margin-bottom: 4px; }
    .subtitle { font-size: 0.8rem; color: #666; margin-bottom: 24px; }
    h2 { font-size: 1rem; color: #aaa; margin: 28px 0 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    h3 { font-size: 0.9rem; color: #ccc; margin: 0 0 10px; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th { text-align: left; padding: 8px 10px; color: #666; font-weight: 500; border-bottom: 1px solid #222; }
    td { padding: 8px 10px; border-bottom: 1px solid #1a1a1a; vertical-align: top; }
    td.key { font-family: monospace; color: #7dd3fc; white-space: nowrap; }
    td.value { font-family: monospace; color: #86efac; word-break: break-all; }
    td.actions { white-space: nowrap; }
    .empty { color: #444; font-style: italic; padding: 12px 10px; }

    /* Buttons */
    button {
      background: #1e1e1e;
      color: #e0e0e0;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 0.8rem;
      cursor: pointer;
      margin-right: 4px;
    }
    button:hover { background: #2a2a2a; border-color: #555; }
    button.danger { color: #f87171; border-color: #3f1f1f; }
    button.danger:hover { background: #2a1010; }
    button.primary { color: #7dd3fc; border-color: #1e3a4a; }
    button.primary:hover { background: #0f2030; }
    button.success { color: #4ade80; border-color: #1a3a1a; }
    button.success:hover { background: #0f2a0f; }

    /* Inputs */
    .form-row { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
    input[type="text"], input[type="password"], textarea {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 4px;
      color: #e0e0e0;
      padding: 6px 10px;
      font-size: 0.875rem;
      font-family: monospace;
      flex: 1;
      min-width: 120px;
    }
    input[type="text"]:focus, input[type="password"]:focus, textarea:focus {
      outline: none; border-color: #555;
    }
    textarea { resize: vertical; min-height: 80px; }

    /* Toggle switch */
    .toggle-wrap { display: flex; align-items: center; gap: 8px; }
    .toggle {
      position: relative; display: inline-block; width: 36px; height: 20px;
    }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
      background: #333; border-radius: 20px; transition: .2s;
    }
    .slider:before {
      position: absolute; content: ""; height: 14px; width: 14px;
      left: 3px; bottom: 3px; background: #888; border-radius: 50%; transition: .2s;
    }
    input:checked + .slider { background: #1e3a4a; }
    input:checked + .slider:before { transform: translateX(16px); background: #7dd3fc; }

    /* Capability cards */
    .cap-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-top: 8px; }
    .cap-card {
      background: #1a1a1a;
      border: 1px solid #222;
      border-radius: 8px;
      padding: 14px 16px;
    }
    .cap-card.enabled { border-color: #1e3a4a; }
    .cap-card.has-error { border-color: #3f1f1f; }
    .cap-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .cap-name { font-size: 0.95rem; font-weight: 600; color: #fff; }
    .cap-meta { font-size: 0.75rem; color: #555; margin-top: 6px; }
    .cap-meta span { margin-right: 10px; }
    .badge {
      display: inline-block; font-size: 0.7rem; padding: 1px 6px;
      border-radius: 3px; font-family: monospace;
    }
    .badge-ok { background: #0f2a1a; color: #4ade80; }
    .badge-missing { background: #2a1010; color: #f87171; }
    .badge-fw { background: #1e2a3a; color: #7dd3fc; }

    /* Detail panel */
    .cap-detail {
      background: #141414;
      border: 1px solid #222;
      border-radius: 8px;
      padding: 16px;
      margin-top: 12px;
      display: none;
    }
    .cap-detail.open { display: block; }
    .detail-section { margin-bottom: 16px; }
    .detail-section:last-child { margin-bottom: 0; }
    .cred-row { display: flex; gap: 8px; margin-bottom: 6px; align-items: center; }
    .cred-key { font-family: monospace; font-size: 0.8rem; color: #7dd3fc; min-width: 120px; }

    /* Health */
    .health-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin-top: 8px; }
    .health-card {
      background: #1a1a1a; border: 1px solid #222; border-radius: 6px;
      padding: 10px 12px; font-size: 0.8rem;
    }
    .health-card .tool-name { color: #aaa; margin-bottom: 2px; }
    .uptime { color: #666; font-size: 0.8rem; margin-top: 8px; }

    /* Messages */
    #msg { font-size: 0.8rem; padding: 6px 10px; border-radius: 4px; margin-top: 8px; display: none; }
    #msg.ok { background: #0f2a1a; color: #4ade80; display: block; }
    #msg.err { background: #2a0f0f; color: #f87171; display: block; }

    /* Raw config section */
    .collapsible-header {
      cursor: pointer; display: flex; align-items: center; gap: 6px;
      color: #666; font-size: 0.8rem; margin-top: 24px; user-select: none;
    }
    .collapsible-header:hover { color: #aaa; }
    .collapsible-body { display: none; margin-top: 8px; }
    .collapsible-body.open { display: block; }
  </style>
</head>
<body>
  <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 4px;">
    <img src="/assets/tino-logo.png" alt="tino" style="width: 48px; height: 48px; border-radius: 10px;">
    <h1>tino config console</h1>
  </div>
  <p class="subtitle">localhost only · capability changes take effect on next restart</p>

  <div id="msg"></div>

  <h2>Capabilities</h2>
  <div id="cap-grid" class="cap-grid"><p class="empty">Loading…</p></div>
  <div id="cap-detail" class="cap-detail"></div>

  <h2>Health</h2>
  <div id="health-section"><p class="empty">Loading…</p></div>

  <div class="collapsible-header" onclick="toggleRawConfig()">
    <span id="raw-toggle-icon">▶</span> Raw config entries
  </div>
  <div id="raw-config-body" class="collapsible-body">
    <table id="config-table">
      <thead><tr><th>Key</th><th>Value</th><th>Updated</th><th></th></tr></thead>
      <tbody id="config-body"><tr><td colspan="4" class="empty">Loading…</td></tr></tbody>
    </table>
    <h2 style="margin-top:16px">Add / Update Entry</h2>
    <div class="form-row">
      <input type="text" id="new-key" placeholder="key (e.g. capability.github)" />
      <input type="text" id="new-value" placeholder='value (JSON)' />
      <button class="primary" onclick="saveEntry()">Save</button>
    </div>
  </div>

  <script>
    let configData = [];
    let capData = [];
    let openCapId = null;

    // ── Capability display names ──────────────────────────────────────────
    const CAP_NAMES = {
      github: 'GitHub',
      linear: 'Linear',
      slack: 'Slack',
      gmail: 'Gmail',
      calendar: 'Calendar',
      cloudwatch: 'CloudWatch',
    };

    const CAP_CRED_KEYS = {
      github: ['token'],
      linear: ['token'],
      slack: ['userToken'],
      gmail: ['clientId', 'clientSecret', 'refreshToken'],
      calendar: ['clientId', 'clientSecret', 'refreshToken'],
      cloudwatch: [],
    };

    const CAP_SETTING_KEYS = {
      github: ['repos', 'defaultRepo'],
      linear: ['defaultTeamKey', 'autoPickupStates'],
      slack: [],
      gmail: [],
      calendar: ['calendarId'],
      cloudwatch: ['logGroups', 'region'],
    };

    // ── Load data ─────────────────────────────────────────────────────────
    async function loadAll() {
      await Promise.all([loadCapabilities(), loadConfig(), loadHealth()]);
    }

    async function loadCapabilities() {
      try {
        const res = await fetch('/api/capabilities');
        capData = await res.json();
        renderCapabilities();
      } catch (e) {
        showMsg('Failed to load capabilities: ' + e.message, 'err');
      }
    }

    async function loadConfig() {
      try {
        const res = await fetch('/api/config');
        configData = await res.json();
        renderConfig();
      } catch (e) {
        showMsg('Failed to load config: ' + e.message, 'err');
      }
    }

    // ── Render capabilities ───────────────────────────────────────────────
    function renderCapabilities() {
      const grid = document.getElementById('cap-grid');
      const allIds = Object.keys(CAP_NAMES);

      // Merge capData with known IDs
      const byId = {};
      for (const c of capData) byId[c.id] = c;

      const cards = allIds.map(id => {
        const entry = byId[id];
        const cfg = entry?.config;
        const enabled = cfg?.enabled ?? false;
        const creds = cfg?.credentials ?? {};
        const credKeys = CAP_CRED_KEYS[id] ?? [];
        const credSet = credKeys.length === 0 || credKeys.every(k => creds[k]);
        const credBadge = credKeys.length === 0
          ? '<span class="badge badge-ok">no creds needed</span>'
          : credSet
            ? '<span class="badge badge-ok">✓ credentials set</span>'
            : '<span class="badge badge-missing">✗ credentials missing</span>';
        const fwEnabled = cfg?.findWork?.enabled ?? false;
        const fwBadge = fwEnabled ? '<span class="badge badge-fw">findWork on</span>' : '';
        const cardClass = enabled ? 'cap-card enabled' : 'cap-card';

        return \`<div class="\${cardClass}" id="card-\${id}">
          <div class="cap-header">
            <span class="cap-name">\${CAP_NAMES[id] ?? id}</span>
            <label class="toggle" title="Enable/disable \${id}">
              <input type="checkbox" \${enabled ? 'checked' : ''} onchange="toggleCapability('\${id}', this.checked)">
              <span class="slider"></span>
            </label>
          </div>
          <div class="cap-meta">
            \${credBadge} \${fwBadge}
          </div>
          <div style="margin-top:10px">
            <button onclick="openCapDetail('\${id}')">Configure</button>
          </div>
        </div>\`;
      }).join('');

      grid.innerHTML = cards;
    }

    // ── Capability detail panel ───────────────────────────────────────────
    function openCapDetail(id) {
      openCapId = id;
      const panel = document.getElementById('cap-detail');
      const entry = capData.find(c => c.id === id);
      const cfg = entry?.config ?? { enabled: false, credentials: {}, settings: {}, findWork: { enabled: false, intervalMinutes: 15 } };

      const credKeys = CAP_CRED_KEYS[id] ?? [];
      const settingKeys = CAP_SETTING_KEYS[id] ?? [];

      const credRows = credKeys.map(k => {
        const val = cfg.credentials?.[k] ?? '';
        return \`<div class="cred-row">
          <span class="cred-key">\${escHtml(k)}</span>
          <input type="password" id="cred-\${id}-\${k}" value="\${escHtml(val)}" placeholder="not set" style="flex:1">
        </div>\`;
      }).join('') || '<p style="color:#555;font-size:0.8rem">No credentials required</p>';

      const settingRows = settingKeys.map(k => {
        const val = cfg.settings?.[k];
        const display = val !== undefined ? JSON.stringify(val) : '';
        return \`<div class="cred-row">
          <span class="cred-key">\${escHtml(k)}</span>
          <input type="text" id="setting-\${id}-\${k}" value="\${escHtml(display)}" placeholder="JSON value">
        </div>\`;
      }).join('') || '<p style="color:#555;font-size:0.8rem">No settings</p>';

      const fwEnabled = cfg.findWork?.enabled ?? false;
      const fwInterval = cfg.findWork?.intervalMinutes ?? 15;

      panel.innerHTML = \`
        <h3>\${CAP_NAMES[id] ?? id} — Configuration</h3>

        <div class="detail-section">
          <h3 style="font-size:0.8rem;color:#666;margin-bottom:8px">CREDENTIALS</h3>
          \${credRows}
          \${credKeys.length > 0 ? '<button class="primary" style="margin-top:8px" onclick="saveCredentials(\\'' + id + '\\')">Save Credentials</button>' : ''}
        </div>

        <div class="detail-section">
          <h3 style="font-size:0.8rem;color:#666;margin-bottom:8px">SETTINGS</h3>
          \${settingRows}
          \${settingKeys.length > 0 ? '<button class="primary" style="margin-top:8px" onclick="saveSettings(\\'' + id + '\\')">Save Settings</button>' : ''}
        </div>

        <div class="detail-section">
          <h3 style="font-size:0.8rem;color:#666;margin-bottom:8px">FIND WORK</h3>
          <div class="toggle-wrap" style="margin-bottom:8px">
            <label class="toggle">
              <input type="checkbox" id="fw-enabled-\${id}" \${fwEnabled ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
            <span style="font-size:0.8rem;color:#aaa">Enabled</span>
          </div>
          <div class="cred-row">
            <span class="cred-key">interval (min)</span>
            <input type="text" id="fw-interval-\${id}" value="\${fwInterval}" style="max-width:80px">
          </div>
          <button class="primary" style="margin-top:8px" onclick="saveFindWork('\${id}')">Save findWork</button>
        </div>

        <button class="danger" style="margin-top:4px" onclick="closeCapDetail()">Close</button>
      \`;

      panel.classList.add('open');
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function closeCapDetail() {
      document.getElementById('cap-detail').classList.remove('open');
      openCapId = null;
    }

    // ── Capability mutations ──────────────────────────────────────────────
    async function toggleCapability(id, enabled) {
      const entry = capData.find(c => c.id === id);
      const cfg = entry?.config ?? { enabled: false, credentials: {}, settings: {} };
      cfg.enabled = enabled;
      await putCapability(id, cfg);
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
      await putCapability(id, cfg);
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
        catch { showMsg('Invalid JSON for setting ' + k, 'err'); return; }
      }
      await putCapability(id, cfg);
    }

    async function saveFindWork(id) {
      const entry = capData.find(c => c.id === id);
      const cfg = JSON.parse(JSON.stringify(entry?.config ?? { enabled: false, credentials: {}, settings: {} }));
      const fwEnabled = document.getElementById('fw-enabled-' + id)?.checked ?? false;
      const fwInterval = parseInt(document.getElementById('fw-interval-' + id)?.value ?? '15', 10);
      cfg.findWork = { enabled: fwEnabled, intervalMinutes: isNaN(fwInterval) ? 15 : fwInterval };
      await putCapability(id, cfg);
    }

    async function putCapability(id, cfg) {
      try {
        const res = await fetch('/api/capabilities/' + encodeURIComponent(id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cfg),
        });
        if (!res.ok) throw new Error(await res.text());
        showMsg('Saved ' + id + ' capability config', 'ok');
        await loadCapabilities();
        if (openCapId === id) openCapDetail(id);
      } catch (e) {
        showMsg('Save failed: ' + e.message, 'err');
      }
    }

    // ── Raw config ────────────────────────────────────────────────────────
    function renderConfig() {
      const tbody = document.getElementById('config-body');
      if (configData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty">No entries yet.</td></tr>';
        return;
      }
      tbody.innerHTML = configData.map(entry => {
        const ts = new Date(entry.updatedAt).toLocaleString();
        const safeKey = escHtml(entry.key);
        const safeVal = escHtml(entry.value);
        return \`<tr>
          <td class="key">\${safeKey}</td>
          <td class="value"><span id="val-\${safeKey}">\${safeVal}</span></td>
          <td style="color:#555;font-size:0.75rem;white-space:nowrap">\${ts}</td>
          <td class="actions">
            <button onclick="editEntry('\${safeKey}')">Edit</button>
            <button class="danger" onclick="deleteEntry('\${safeKey}')">Delete</button>
          </td>
        </tr>\`;
      }).join('');
    }

    function editEntry(key) {
      const current = configData.find(e => e.key === key);
      const newVal = prompt('Edit value for ' + key + ':', current ? current.value : '');
      if (newVal === null) return;
      putEntry(key, newVal);
    }

    async function deleteEntry(key) {
      if (!confirm('Delete ' + key + '?')) return;
      try {
        const res = await fetch('/api/config/' + encodeURIComponent(key), { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        showMsg('Deleted ' + key, 'ok');
        await loadConfig();
      } catch (e) {
        showMsg('Delete failed: ' + e.message, 'err');
      }
    }

    async function saveEntry() {
      const key = document.getElementById('new-key').value.trim();
      const value = document.getElementById('new-value').value.trim();
      if (!key) { showMsg('Key is required', 'err'); return; }
      if (!value) { showMsg('Value is required', 'err'); return; }
      try { JSON.parse(value); } catch { showMsg('Value must be valid JSON', 'err'); return; }
      await putEntry(key, value);
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
        showMsg('Saved ' + key, 'ok');
        await loadConfig();
      } catch (e) {
        showMsg('Save failed: ' + e.message, 'err');
      }
    }

    // ── Health ────────────────────────────────────────────────────────────
    async function loadHealth() {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        const section = document.getElementById('health-section');
        const uptimeSec = Math.floor(data.uptime);
        const h = Math.floor(uptimeSec / 3600);
        const m = Math.floor((uptimeSec % 3600) / 60);
        const s = uptimeSec % 60;
        const uptimeStr = h > 0 ? \`\${h}h \${m}m\` : m > 0 ? \`\${m}m \${s}s\` : \`\${s}s\`;
        const toolCards = data.tools.map(t =>
          \`<div class="health-card"><div class="tool-name">\${escHtml(t)}</div></div>\`
        ).join('');
        section.innerHTML = \`
          <div class="health-grid">\${toolCards || '<p class="empty">No tools registered</p>'}</div>
          <p class="uptime">Uptime: \${uptimeStr} · \${data.tools.length} tools</p>
        \`;
      } catch (e) {
        document.getElementById('health-section').innerHTML = '<p class="empty" style="color:#f87171">Health check failed</p>';
      }
    }

    // ── Collapsible raw config ────────────────────────────────────────────
    function toggleRawConfig() {
      const body = document.getElementById('raw-config-body');
      const icon = document.getElementById('raw-toggle-icon');
      const open = body.classList.toggle('open');
      icon.textContent = open ? '▼' : '▶';
    }

    // ── Utilities ─────────────────────────────────────────────────────────
    function showMsg(text, type) {
      const el = document.getElementById('msg');
      el.textContent = text;
      el.className = type;
      clearTimeout(el._timer);
      el._timer = setTimeout(() => { el.className = ''; }, 4000);
    }

    function escHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    loadAll();
  </script>
</body>
</html>`;
}
