# wave 1: make it work

fix the bugs that prevent basic functionality. after this wave, tino starts correctly, the console loads, and the session survives restarts.

## items

### 1.1 fix console API returning HTML instead of JSON (gap #2)

**problem:** when the session cookie is missing or invalid, the auth middleware returns the HTML login page for ALL routes — including `/api/config`, `/api/health`, etc. the console's JS `fetch('/api/config')` gets `<!DOCTYPE` instead of JSON.

**fix:** 
- API routes (`/api/*` except `/api/auth/*`) return 401 JSON when no session, not HTML
- the console JS detects 401 and redirects to the login page
- partially done in the last commit — verify it works end-to-end

**acceptance:**
- [ ] `fetch('/api/config')` without a session cookie returns `{"error":"unauthorized"}` with status 401
- [ ] `fetch('/api/config')` with a valid session cookie returns the config array as JSON
- [ ] the console page detects 401 and shows the login page

### 1.2 fix preferences tools disabled (gap #6)

**problem:** the preferences store uses SQLite (`better-sqlite3`) which tries to write to the filesystem. in production, the root filesystem is read-only. the `/tmp` volume exists but the preferences store isn't configured to use it.

**fix:**
- when `PERSISTENCE_ADAPTER=dynamodb`, the preferences store should use DynamoDB (it already has a DynamoDB adapter)
- the `buildTools` function creates the preferences store — it should check the adapter and use the right one
- alternatively: the preferences store should use `/tmp/tino-prefs.db` in production (simpler, but loses data on restart)

**acceptance:**
- [ ] `preferences tools enabled` in the startup logs (not `disabled`)
- [ ] `set_preference` and `get_preferences` tools work in Slack DMs

### 1.3 fix session persistence across restarts (gap #7)

**problem:** better-auth's session database is SQLite at `/tmp/tino-auth.db`. when the ECS task restarts, `/tmp` is wiped, all sessions are lost, users have to re-login.

**fix:**
- store better-auth sessions in DynamoDB instead of SQLite
- better-auth supports custom database adapters — write a DynamoDB adapter or use the secondary storage feature (Redis-like key-value for sessions)
- alternatively: accept that sessions are lost on restart (users re-login). this is acceptable for MVP if restarts are rare.

**acceptance:**
- [ ] after ECS task restart, the user's session is still valid (no re-login required)
- OR: document that sessions are lost on restart and ensure the re-login flow is smooth (< 5 seconds)

### 1.4 fix logo loading in production (gap #13)

**problem:** the logo route tries multiple path candidates but may still fail. the `assets/` directory is copied into the Docker image but the path resolution depends on `process.cwd()` which may not be `/app`.

**fix:**
- use an absolute path: `/app/assets/tino-logo.png` (the Dockerfile WORKDIR is `/app`)
- or embed the logo as a base64 data URI in the HTML (eliminates the file-serving problem entirely, but the logo is 1.2MB which is too large for inline)
- or serve from a known absolute path and verify it works in the Docker image

**acceptance:**
- [ ] logo loads on the console page in production
- [ ] logo loads on the login page in production
