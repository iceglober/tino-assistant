/**
 * Self-contained HTML page for the tino config console.
 * No build step, no framework — inline CSS + JS only.
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
      max-width: 900px;
      margin: 0 auto;
    }
    h1 { font-size: 1.4rem; color: #fff; margin-bottom: 4px; }
    .subtitle { font-size: 0.8rem; color: #666; margin-bottom: 24px; }
    h2 { font-size: 1rem; color: #aaa; margin: 24px 0 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th { text-align: left; padding: 8px 10px; color: #666; font-weight: 500; border-bottom: 1px solid #222; }
    td { padding: 8px 10px; border-bottom: 1px solid #1a1a1a; vertical-align: top; }
    td.key { font-family: monospace; color: #7dd3fc; white-space: nowrap; }
    td.value { font-family: monospace; color: #86efac; word-break: break-all; }
    td.actions { white-space: nowrap; }
    .empty { color: #444; font-style: italic; padding: 12px 10px; }
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
    .form-row { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    input[type="text"] {
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
    input[type="text"]:focus { outline: none; border-color: #555; }
    .quick-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    .health-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin-top: 8px; }
    .health-card {
      background: #1a1a1a;
      border: 1px solid #222;
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 0.8rem;
    }
    .health-card .tool-name { color: #aaa; margin-bottom: 2px; }
    .health-card .tool-status { font-family: monospace; font-size: 0.75rem; color: #666; }
    .uptime { color: #666; font-size: 0.8rem; margin-top: 8px; }
    .status-ok { color: #4ade80; }
    .status-err { color: #f87171; }
    #msg { font-size: 0.8rem; padding: 6px 10px; border-radius: 4px; margin-top: 8px; display: none; }
    #msg.ok { background: #0f2a1a; color: #4ade80; display: block; }
    #msg.err { background: #2a0f0f; color: #f87171; display: block; }
  </style>
</head>
<body>
  <h1>tino config console</h1>
  <p class="subtitle">localhost only · changes take effect on next tool call</p>

  <div id="msg"></div>

  <h2>Config</h2>
  <table id="config-table">
    <thead><tr><th>Key</th><th>Value</th><th>Updated</th><th></th></tr></thead>
    <tbody id="config-body"><tr><td colspan="4" class="empty">Loading…</td></tr></tbody>
  </table>

  <h2>Add / Update Entry</h2>
  <div class="form-row">
    <input type="text" id="new-key" placeholder="key (e.g. github.repos)" />
    <input type="text" id="new-value" placeholder='value (JSON, e.g. ["owner/repo"])' />
    <button class="primary" onclick="saveEntry()">Save</button>
  </div>

  <h2>Quick Actions</h2>
  <div class="quick-actions">
    <button onclick="quickAdd('github.repos', 'Add GitHub repo (owner/repo):', 'github.repos')">+ GitHub Repo</button>
    <button onclick="quickAdd('github.default_repo', 'Default GitHub repo (owner/repo):', 'github.default_repo')">Set Default Repo</button>
    <button onclick="quickAdd('cloudwatch.log_groups', 'Add CloudWatch log group:', 'cloudwatch.log_groups')">+ CloudWatch Log Group</button>
    <button onclick="quickAdd('cloudwatch.region', 'CloudWatch region:', 'cloudwatch.region')">Set CW Region</button>
  </div>

  <h2>Health</h2>
  <div id="health-section"><p class="empty">Loading…</p></div>

  <script>
    let configData = [];

    async function loadConfig() {
      try {
        const res = await fetch('/api/config');
        configData = await res.json();
        renderConfig();
      } catch (e) {
        showMsg('Failed to load config: ' + e.message, 'err');
      }
    }

    function renderConfig() {
      const tbody = document.getElementById('config-body');
      if (configData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty">No entries yet. Use the form below to add one.</td></tr>';
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

    async function quickAdd(key, prompt_text, configKey) {
      const existing = configData.find(e => e.key === configKey);
      let currentArr = [];
      if (existing) {
        try { currentArr = JSON.parse(existing.value); } catch {}
      }
      const input = prompt(prompt_text);
      if (!input) return;
      const trimmed = input.trim();
      if (configKey === 'github.repos' || configKey === 'cloudwatch.log_groups') {
        if (!Array.isArray(currentArr)) currentArr = [];
        if (!currentArr.includes(trimmed)) currentArr.push(trimmed);
        await putEntry(configKey, JSON.stringify(currentArr));
      } else {
        await putEntry(configKey, JSON.stringify(trimmed));
      }
    }

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
        document.getElementById('health-section').innerHTML = '<p class="empty status-err">Health check failed</p>';
      }
    }

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

    loadConfig();
    loadHealth();
  </script>
</body>
</html>`;
}
