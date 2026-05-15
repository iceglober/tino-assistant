# wave 2: make it configurable

the console can configure all capabilities. after this wave, a user can enable GitHub, Linear, Calendar, Gmail, and Slack reading entirely from the console — no code changes, no env vars.

## items

### 2.1 capability configuration UI in the console (gap #3)

**problem:** the console only shows the Slack setup + basics screens. there's no UI for configuring GitHub, Linear, Calendar, Gmail, Slack reading, or CloudWatch.

**fix:**
- the "full console" screen (after Slack + basics are configured) shows capability cards for each integration
- each card shows: name, description, status (connected / needs setup), and a "configure" button
- clicking "configure" expands the card to show credential inputs + settings
- capabilities to support:
  - **GitHub**: PAT input, default repo, repo allowlist
  - **Linear**: developer token input
  - **Google Calendar**: OAuth refresh token (or "connect with Google" button)
  - **Gmail**: shares Google OAuth, just needs to be enabled
  - **Slack reading**: user token (xoxp-) input
  - **CloudWatch**: log group allowlist (no credentials — uses the task role)

**acceptance:**
- [ ] all 6 capability cards visible in the console
- [ ] each card can be expanded to show configuration inputs
- [ ] saving a capability's credentials writes to the config store
- [ ] the capability status updates after saving (shows "connected" or "needs setup")

### 2.2 capability registration reads from config store (gap #1)

**problem:** `buildTools` in `src/tools/index.ts` reads credentials from env vars and hardcoded allowlists. in production, credentials are in the DynamoDB config store (written by the console). the tools don't register because the env vars are empty.

**fix:**
- `buildTools` reads each capability's credentials from the config store
- config keys follow the pattern: `github.token`, `github.defaultRepo`, `github.repos`, `linear.token`, `google.refreshToken`, `slack.userToken`, `cloudwatch.logGroups`
- fall back to env vars for backward compatibility (local dev with `.env`)

**acceptance:**
- [ ] after saving a GitHub PAT in the console and restarting, `github tools enabled` appears in logs
- [ ] after saving a Linear token, `linear tools enabled` appears
- [ ] all 22 tools register when all capabilities are configured
- [ ] `toolCount: 22` (or close) in the startup logs

### 2.3 validate bedrock model ID (gap #15)

**problem:** if the model ID saved in the config store is wrong (typo, model not available), tino crashes on the first message with an opaque Bedrock error.

**fix:**
- on startup, after reading `bedrock.modelId` from config, make a lightweight Bedrock call to verify the model is accessible (e.g., `InvokeModel` with a tiny prompt, or `ListInferenceProfiles` to check the ID exists)
- if validation fails, log a clear error and fall back to the default model ID
- the console should also validate the model ID when saving (call the Bedrock API from the server)

**acceptance:**
- [ ] invalid model ID → clear error log, tino still starts (falls back to default)
- [ ] valid model ID → tino uses it, no error

### 2.4 console shows active capabilities (gap #11)

**problem:** the console doesn't show which capabilities are currently active (tools registered) vs which need setup.

**fix:**
- the `/api/health` endpoint already returns `tools` (list of registered tool names)
- the console reads this and maps tool names to capabilities
- each capability card shows a green dot if its tools are registered, red if not

**acceptance:**
- [ ] capability cards show green/red status based on actual tool registration
- [ ] status updates after page refresh (or via polling)

### 2.5 console "signed in as" indicator (gap #19)

**problem:** the console should show who's logged in and provide a sign-out link.

**fix:**
- the auth middleware passes the session user info to the HTML template
- or: the console JS calls `/api/auth/get-session` to get the current user
- display email + sign-out link in the console header

**acceptance:**
- [ ] console header shows the logged-in user's email
- [ ] "sign out" link works and redirects to the login page
